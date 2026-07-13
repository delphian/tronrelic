/**
 * @file curation-service.ts
 *
 * The central curation service: the registry of reviewable content types and
 * the orchestration of the held-item lifecycle. It is the single `'curation'`
 * service core publishes. Providers register a type (describe / applyEdit /
 * decisionStatus); producers `hold()` effects into the queue; the admin surface
 * lists and decides them. Core owns the decision and the envelope; the owning
 * type owns the payload, the preview, and the declarative status its decisions
 * write.
 *
 * Decision flow records the terminal state first (the queue's atomic gate),
 * then commits the decision declaratively through the owning type's
 * `applyEdit({ status })` seam. A disabled owner — its type no longer
 * registered — blocks the decision rather than dropping the effect, so a held
 * item simply waits for its provider to return.
 */

import { randomUUID } from 'node:crypto';
import type {
    ContentTypeDisposer,
    IContentClassification,
    IContentRegistry,
    IContentRouter,
    IContentSink,
    IHookRegistry,
    ICurationSinkOutcome,
    ICurationSinkSelection,
    ICurationEditPatch,
    ICurationEligibleSink,
    ICurationHoldInput,
    ICurationItem,
    ICurationService,
    ICurationType,
    ICurationTypeInfo,
    ISyndicationLegView,
    ISyndicationService,
    ISystemLogService,
    CurationItemStatus
} from '@/types';
import { presentDescriptorFeatures } from '../../../services/content-classification.js';
import { HOOKS } from '../../../hooks/registry.js';
import { shouldAutoApproveCuration } from './curation-auto-approve-context.js';
import type { CurationQueue } from './curation-queue.js';
import type { CurationSinkDefaults } from './curation-sink-defaults.js';

/**
 * The exposure ceiling applied to a publishes-to-sinks type that declares no
 * `classification` of its own. The most restrictive label, so a type reaches
 * external sinks only by explicitly raising its ceiling — accidental external
 * egress is impossible, which is the fail-safe the classification gate is for.
 */
const DEFAULT_CONTENT_CEILING: IContentClassification = { egress: 'internal', audience: 'admin' };

/** One selected publish sink resolved to its live contract, ready to deliver. */
interface IResolvedSink {
    sink: IContentSink;
    dest: Record<string, unknown>;
}

/**
 * A registered type with the id of the provider that owns it, plus the disposer
 * that removes this type's content facet from the central content registry —
 * held so unregister (or a replacing re-registration) drops the shared-registry
 * mirror in lockstep with the local map, preventing drift.
 */
interface IRegisteredType {
    type: ICurationType;
    providerId: string;
    contentDisposer: ContentTypeDisposer;
}

/** Broadcast sink for dashboard refetch signals (a no-op until wired). */
type BroadcastFn = (event: string, payload: unknown) => void;

/**
 * Listener invoked once per newly held item, immediately after it is persisted.
 * It lets an external consumer (the module) fan an admin notification on each
 * hold without the curation service taking a dependency on the notification
 * service — the same decoupling {@link BroadcastFn} gives the dashboard signal.
 * The registered type's label is passed alongside the item so the consumer need
 * not reach back into the registry. Optional; until wired, holds raise nothing.
 */
type HoldListenerFn = (item: ICurationItem, typeLabel: string) => void;

/** WebSocket event the dashboard listens on to refetch the queue. */
export const CURATIONS_CHANGED_EVENT = 'curation:changed';

/**
 * Decider recorded on an item the governor auto-approves via a tool's
 * `curation: 'auto-approve'` policy — a distinct, non-human actor so the audit
 * separates a policy bypass from a curator's decision.
 */
export const CURATION_AUTO_APPROVE_DECIDED_BY = 'system:policy-auto-approve';

/**
 * Registry + lifecycle orchestrator for the central curation queue.
 */
export class CurationService implements ICurationService {
    private readonly types = new Map<string, IRegisteredType>();
    private broadcast: BroadcastFn | null = null;
    private holdListener: HoldListenerFn | null = null;
    private syndicationResolver: (() => ISyndicationService | undefined) | null = null;

    /**
     * @param logger - Module-scoped logger.
     * @param queue - Persistent store of curation envelopes.
     * @param contentRegistry - The central content-type registry. Curation
     *        mirrors every registered type's content facet into it (a curation
     *        type *is* an `IContentType`) so other pipelines discover the same
     *        content types; curation keeps its own map for the binding verbs.
     * @param contentRouter - The content router, used to compute the publish
     *        sinks a publishes-to-sinks type may deliver to and to resolve a
     *        selected sink for delivery. Optional so a test harness or a boot
     *        without the router degrades to no sink selection rather than
     *        failing — publishes-to-sinks types simply surface no picker.
     * @param sinkDefaults - Standing per-type default-sink policy the picker
     *        pre-selects. Optional for the same degrade-gracefully reason;
     *        absent, defaults read empty and cannot be saved.
     * @param hookRegistry - Core hook registry used to fire the
     *        `content.published` observer seam when an approved item's canonical
     *        content goes live. Optional so a test boot without it simply fires
     *        no seam rather than failing.
     */
    constructor(
        private readonly logger: ISystemLogService,
        private readonly queue: CurationQueue,
        private readonly contentRegistry: IContentRegistry,
        private readonly contentRouter?: IContentRouter,
        private readonly sinkDefaults?: CurationSinkDefaults,
        private readonly hookRegistry?: IHookRegistry
    ) {}

    /**
     * Wire a broadcast sink so decisions and new holds nudge the dashboard to
     * refetch. Optional; until set, notifications are dropped.
     *
     * @param fn - Sink invoked with an event name and payload.
     */
    setBroadcast(fn: BroadcastFn): void {
        this.broadcast = fn;
    }

    /**
     * Wire a listener fired once per new hold so the module can fan an admin
     * notification. Kept separate from the broadcast sink because the two carry
     * different intents: the broadcast is a fire-and-forget dashboard refetch
     * nudge, while this delivers the held item itself for a targeted toast.
     * Optional; until set, new holds raise no notification.
     *
     * @param fn - Listener invoked with the held item and its type's label.
     */
    setOnHold(fn: HoldListenerFn): void {
        this.holdListener = fn;
    }

    /**
     * Wire a resolver for the durable syndication service so an approval's publish
     * legs are committed to the transactional outbox and delivered by its relay —
     * with idempotent retry and dead-lettering — instead of the in-process best-
     * effort fan-out. A resolver (rather than a held reference) defers the lookup
     * to decide-time, so curation init order relative to the syndication module
     * does not matter and a test boot that wires nothing degrades to the best-
     * effort path. The same resolver overlays live leg state onto decided items'
     * sink outcomes on read.
     *
     * @param fn - Resolver returning the syndication service, or undefined when absent.
     */
    setSyndicationResolver(fn: () => ISyndicationService | undefined): void {
        this.syndicationResolver = fn;
    }

    /**
     * Register a reviewable content type. A later registration for the same id
     * replaces the earlier one (an operator re-enabling a provider).
     *
     * @param type - The type contract.
     * @param providerId - Id of the registering plugin or module.
     */
    registerType(type: ICurationType, providerId: string): void {
        // Coherence guard — backstop for a plugin compiled against the older,
        // pre-collapse interface where these were optional. A curation type must
        // declare its required rejection word and the applyEdit commit seam.
        if (!type.decisionStatus?.rejected) {
            throw new Error(`Curation type '${type.typeId}' must declare decisionStatus.rejected`);
        }
        if (typeof type.applyEdit !== 'function') {
            throw new Error(`Curation type '${type.typeId}' must implement applyEdit (the decision commit seam)`);
        }
        // A replacing registration must dispose the prior content-registry
        // mirror before installing the new one, so the shared registry never
        // accumulates a stale facet for the same id.
        this.types.get(type.typeId)?.contentDisposer();
        const contentDisposer = this.contentRegistry.register(type, providerId);
        this.types.set(type.typeId, { type, providerId, contentDisposer });
        this.logger.info({ typeId: type.typeId, providerId }, 'Curation type registered');
    }

    /**
     * Unregister a type. Held items of this type remain but cannot be decided
     * until it re-registers.
     *
     * @param typeId - The namespaced type id.
     * @returns True if a type was removed.
     */
    unregisterType(typeId: string): boolean {
        // Drop the content-registry mirror in lockstep with the local entry so a
        // disabled provider's content facet does not linger for other pipelines.
        this.types.get(typeId)?.contentDisposer();
        const removed = this.types.delete(typeId);
        if (removed) {
            this.logger.info({ typeId }, 'Curation type unregistered');
        }
        return removed;
    }

    /**
     * Resolve a registered type.
     *
     * @param typeId - The namespaced type id.
     * @returns The type, or undefined when no owner is registered.
     */
    getType(typeId: string): ICurationType | undefined {
        return this.types.get(typeId)?.type;
    }

    /**
     * Whether a type is registered right now — the governor's binding check.
     *
     * @param typeId - The namespaced type id.
     * @returns True when an owner is registered.
     */
    hasType(typeId: string): boolean {
        return this.types.has(typeId);
    }

    /**
     * List all registered types for the admin dashboard.
     *
     * @returns One info record per registered type.
     */
    listTypes(): ICurationTypeInfo[] {
        return Array.from(this.types.entries()).map(([typeId, entry]) => ({
            typeId,
            label: entry.type.label,
            providerId: entry.providerId
        }));
    }

    /**
     * Hold an effect for review: resolve the type, cache a preview, persist the
     * envelope as `pending`, and signal the dashboard.
     *
     * When the active governed invocation opted its held effects into
     * auto-approval (an interactive admin policy bypass — see
     * {@link shouldAutoApproveCuration}), the freshly held item is approved
     * immediately under {@link CURATION_AUTO_APPROVE_DECIDED_BY}, committing the
     * owning type's declared approval status via `applyEdit` before this returns.
     * A bypass that fails to commit propagates exactly as a manual approval's
     * failure would.
     *
     * A `publishesToSinks` type is exempt from the bypass: approval of a routed
     * type *is* the curator's sink selection, which auto-approve cannot supply, so
     * the item is left `pending` for a human rather than approved with an empty
     * selection — which would mark the effect published while routing to no sinks.
     *
     * The hold listener fires for every hold — before the auto-approve branch —
     * so an admin is notified whenever anything enters the queue, regardless of
     * whether a policy bypass then decides it immediately.
     *
     * @param input - The type id, opaque ref, and optional attribution.
     * @returns The stored envelope — `approved` when auto-approved, else `pending`.
     * @throws When the type id is not registered.
     */
    async hold(input: ICurationHoldInput): Promise<ICurationItem> {
        const entry = this.types.get(input.typeId);
        if (!entry) {
            throw new Error(`No curation type registered for "${input.typeId}"`);
        }
        const preview = await entry.type.describe(input.ref);
        const item: ICurationItem = {
            id: randomUUID(),
            typeId: input.typeId,
            providerId: entry.providerId,
            ref: input.ref,
            preview,
            status: 'pending',
            source: input.source,
            createdAt: new Date()
        };
        await this.queue.insert(item);
        await this.notifyChanged();
        // Notify on every hold, before the auto-approve branch. The listener is a
        // synchronous fire-and-forget sink the module owns; guard it so a faulty
        // listener cannot derail the hold or its downstream auto-approve.
        try {
            this.holdListener?.(item, entry.type.label);
        } catch (error) {
            this.logger.warn({ error, id: item.id }, 'Curation hold listener failed');
        }
        let result = item;
        if (shouldAutoApproveCuration()) {
            if (entry.type.publishesToSinks) {
                // A sink-routed type cannot be auto-approved: for such a type
                // approval *is* the curator's sink selection (the mandated
                // subset), and the auto-approve bypass supplies none. Approving
                // with no selection would route to zero sinks — marking the effect
                // published while delivering nothing — so the bypass is refused and
                // the item waits for a human to pick sinks, exactly as if
                // auto-approve were not configured.
                this.logger.warn(
                    { id: item.id, typeId: item.typeId },
                    'Curation auto-approve skipped — a sink-routed type requires an explicit sink selection'
                );
            } else {
                this.logger.info({ id: item.id, typeId: item.typeId }, 'Curation auto-approved by tool policy (interactive bypass)');
                const approved = await this.approve(item.id, CURATION_AUTO_APPROVE_DECIDED_BY);
                result = approved ?? item;
            }
        }
        return result;
    }

    /**
     * List pending envelopes newest-first for the admin queue.
     *
     * @param limit - Maximum envelopes to return.
     * @returns The pending envelopes.
     */
    async listPending(limit?: number): Promise<ICurationItem[]> {
        const items = await this.queue.listPending(limit);
        return Promise.all(items.map(item => this.withLivePreview(item)));
    }

    /**
     * Count pending envelopes for the dashboard badge.
     *
     * @returns The pending count.
     */
    async countPending(): Promise<number> {
        return this.queue.countPending();
    }

    /**
     * List decided envelopes (approved/rejected) newest-first for the history view.
     * Unlike `listPending`, these are returned with their cached preview rather than
     * a live `describe()`: history records what was decided at decision time, so the
     * snapshot frozen into the envelope is the faithful view — re-deriving from the
     * owner's current record could misrepresent a past decision.
     *
     * @param limit - Maximum envelopes to return.
     * @returns The decided envelopes.
     */
    async listHistory(limit?: number): Promise<ICurationItem[]> {
        const items = await this.queue.listHistory(limit);
        return this.overlayHistorySinks(items);
    }

    /**
     * Fetch one envelope by id, resolving a live preview while it is pending and
     * its owner is registered.
     *
     * @param id - The envelope id.
     * @returns The envelope, or null when absent.
     */
    async get(id: string): Promise<ICurationItem | null> {
        const item = await this.queue.get(id);
        if (!item) {
            return null;
        }
        // Pending items show a live preview; decided items show live delivery
        // state overlaid onto their recorded sink outcomes.
        return item.status === 'pending'
            ? this.withLivePreview(item)
            : this.overlaySyndicationOutcomes(item);
    }

    /**
     * Resolve an item's preview live from its registered type so the queue never
     * shows a stale snapshot while the owner is present (the cached preview is the
     * disabled-owner fallback, per the curation design). Falls back to the cached
     * snapshot when the owner is unregistered or `describe()` fails.
     *
     * @param item - The stored envelope.
     * @returns The envelope with a freshly resolved preview, or the original.
     */
    private async withLivePreview(item: ICurationItem): Promise<ICurationItem> {
        const entry = this.types.get(item.typeId);
        let resolved = item;
        if (entry) {
            try {
                const preview = await entry.type.describe(item.ref);
                resolved = { ...item, preview };
            } catch (error) {
                this.logger.warn({ error, id: item.id }, 'Live preview resolution failed; using cached snapshot');
            }
        }
        return resolved;
    }

    /**
     * Overlay live syndication leg state onto one decided item's recorded sink
     * outcomes. With durable delivery, the stored outcomes are written `pending`
     * at decision time and advanced by the relay out-of-band; reading the outbox
     * here shows the operator where an approved item actually stands rather than a
     * frozen `pending` snapshot. The outbox is the single source of truth, so the
     * stored outcome is only a fallback (no syndication wired, the lookup failed,
     * or the leg is gone). A degraded lookup never fails the read.
     *
     * @param item - A decided envelope, possibly carrying sink outcomes.
     * @returns The item with live-overlaid outcomes, or the original.
     */
    private async overlaySyndicationOutcomes(item: ICurationItem): Promise<ICurationItem> {
        const syndication = this.syndicationResolver?.();
        if (!syndication || !item.sinks || item.sinks.length === 0) {
            return item;
        }
        try {
            const legs = await syndication.getLegs(item.id);
            return legs.length > 0 ? this.applyLegOverlay(item, legs) : item;
        } catch (error) {
            this.logger.warn({ error, id: item.id }, 'Syndication leg overlay failed; using stored outcomes');
            return item;
        }
    }

    /**
     * Batch variant of {@link overlaySyndicationOutcomes} for the history list —
     * one outbox query for every decided item that carries sinks, so a paginated
     * history view does not fan out N lookups.
     *
     * @param items - The decided envelopes to overlay.
     * @returns The items with live-overlaid outcomes where legs exist.
     */
    private async overlayHistorySinks(items: ICurationItem[]): Promise<ICurationItem[]> {
        const syndication = this.syndicationResolver?.();
        const originIds = items.filter((i) => i.sinks && i.sinks.length > 0).map((i) => i.id);
        if (!syndication || originIds.length === 0) {
            return items;
        }
        let legsByOrigin: Record<string, ISyndicationLegView[]>;
        try {
            legsByOrigin = await syndication.getLegsForOrigins(originIds);
        } catch (error) {
            this.logger.warn({ error }, 'Syndication leg overlay (history) failed; using stored outcomes');
            return items;
        }
        return items.map((item) => {
            const legs = legsByOrigin[item.id];
            return legs && legs.length > 0 ? this.applyLegOverlay(item, legs) : item;
        });
    }

    /**
     * Replace each recorded sink outcome with the live state of its matching
     * syndication leg, keyed by sink id. An outcome whose sink has no leg (an
     * unexpected mismatch) keeps its stored value.
     *
     * @param item - The decided envelope.
     * @param legs - The live legs for this item.
     * @returns A copy of the item with overlaid sink outcomes.
     */
    private applyLegOverlay(item: ICurationItem, legs: ISyndicationLegView[]): ICurationItem {
        const bySink = new Map(legs.map((leg) => [leg.sinkId, leg]));
        const sinks = (item.sinks ?? []).map((outcome) => {
            const leg = bySink.get(outcome.sinkId);
            return leg ? this.legToOutcome(outcome.sinkId, leg) : outcome;
        });
        return { ...item, sinks };
    }

    /**
     * Project one syndication leg's lifecycle state onto curation's four-state
     * sink outcome. The mapping deliberately collapses syndication's richer
     * states: `delivering` and a retryable `failed` both read as `pending` (still
     * in flight from a curator's view), while a dead-lettered leg reads as the
     * terminal `failed` an operator must act on. `delivered` and `refused` map
     * across directly, carrying the reason verbatim.
     *
     * @param sinkId - The sink id.
     * @param leg - The live leg view.
     * @returns The curation sink outcome reflecting the leg.
     */
    private legToOutcome(sinkId: string, leg: ISyndicationLegView): ICurationSinkOutcome {
        switch (leg.status) {
            case 'delivered':
                return { sinkId, status: 'delivered' };
            case 'refused':
                return { sinkId, status: 'refused', reason: leg.reason };
            case 'dead':
                return { sinkId, status: 'failed', error: leg.lastError };
            default:
                // pending / delivering / (retryable) failed — still in flight.
                return { sinkId, status: 'pending' };
        }
    }

    /**
     * Approve a pending envelope, then commit it through the owning type.
     *
     * @param id - The envelope id.
     * @param decidedBy - Better Auth user id of the deciding curator.
     * @param sinks - The curator-selected publish sinks to deliver the approved
     *        content to; each must be one of the item's eligible publish sinks.
     *        Omit for the classic single-effect approval.
     * @returns The decided envelope, or null when blocked (missing, no longer
     *          pending, or owner unregistered).
     * @throws When a selected sink is not eligible (before any decision is
     *         recorded), or when the owning type's `applyEdit` commit fails (after
     *         the decision is recorded, so the caller surfaces the failure).
     */
    async approve(
        id: string,
        decidedBy?: string,
        sinks?: ICurationSinkSelection[]
    ): Promise<ICurationItem | null> {
        return this.decide(id, 'approved', decidedBy, sinks);
    }

    /**
     * Reject a pending envelope, then discard it through the owning type.
     *
     * @param id - The envelope id.
     * @param decidedBy - Better Auth user id of the deciding curator.
     * @returns The decided envelope, or null under the same conditions as approve.
     * @throws When the owning type's `applyEdit` commit fails; the decision is
     *         still recorded.
     */
    async reject(id: string, decidedBy?: string): Promise<ICurationItem | null> {
        return this.decide(id, 'rejected', decidedBy);
    }

    /**
     * Apply an operator's inline edit to a pending item through its owning type,
     * then re-derive and re-cache the preview. The owning type validates the
     * patch and owns the write (core never touches the payload), mirroring how
     * approve/reject delegate. Returns null when the item is gone, decided, its
     * owner is unregistered, or the type is not editable. Propagates a throw from
     * the type's `applyEdit` (validation) so the caller surfaces it.
     *
     * @param id - The envelope id.
     * @param patch - The generic edit to apply.
     * @param editedBy - Better Auth user id of the editing operator.
     * @returns The item with refreshed preview, or null when not editable.
     */
    async edit(id: string, patch: ICurationEditPatch, editedBy?: string): Promise<ICurationItem | null> {
        const existing = await this.queue.get(id);
        let result: ICurationItem | null = null;
        if (existing && existing.status === 'pending') {
            const entry = this.types.get(existing.typeId);
            if (entry?.type.applyEdit) {
                // Re-confirm pending immediately before mutating the provider
                // payload, narrowing the edit-vs-decide race. The window is not
                // fully closed, so a registered type's applyEdit should also guard
                // on its own pending state (x-poster's editPostText conditions on
                // pending_approval) for complete safety.
                const latest = await this.queue.get(id);
                if (latest && latest.status === 'pending') {
                    await entry.type.applyEdit(latest.ref, patch);
                    // The edit already landed in the provider's record; a failure
                    // to re-derive the preview must not report the edit as failed.
                    // Fall back to patching the cached body so the snapshot still
                    // advances and the API returns success.
                    let preview = latest.preview;
                    try {
                        preview = await entry.type.describe(latest.ref);
                    } catch (error) {
                        this.logger.error({ error, id }, 'Re-describe after edit failed; falling back to the patched body');
                        if (patch.body !== undefined) {
                            preview = { ...preview, body: patch.body };
                        }
                    }
                    await this.queue.updatePreview(id, preview);
                    await this.notifyChanged();
                    this.logger.info({ id, typeId: latest.typeId, editedBy }, 'Curation item edited');
                    result = { ...latest, preview };
                }
            }
        }
        return result;
    }

    /**
     * The publish sinks the content router admits for a pending item's type, each
     * flagged with whether standing policy pre-selects it — the data behind the
     * curation sink picker. Returns empty (so a caller renders no picker) when the
     * item is missing or decided, its type does not publish to sinks, the router
     * is absent, or no publish sink is eligible. The eligibility is computed
     * structurally and through the classification gate, so a content type authored
     * after a sink shows that sink with zero sink edits.
     *
     * @param id - The pending envelope id.
     * @returns The eligible publish sinks for the item.
     */
    async listEligibleSinks(id: string): Promise<ICurationEligibleSink[]> {
        let result: ICurationEligibleSink[] = [];
        const item = await this.queue.get(id);
        if (item && item.status === 'pending') {
            const entry = this.types.get(item.typeId);
            if (entry && entry.type.publishesToSinks && this.contentRouter) {
                let descriptor = item.preview;
                try {
                    descriptor = await entry.type.describe(item.ref);
                } catch (error) {
                    this.logger.warn({ error, id }, 'Sink eligibility preview resolution failed; using cached snapshot');
                }
                const publishSinks = this.eligiblePublishSinks(entry.type, descriptor);
                const defaults = await this.getSinkDefaults(item.typeId);
                result = publishSinks.map((sink) => ({
                    sinkId: sink.id,
                    label: sink.label,
                    reach: sink.reach,
                    defaultSelected: defaults.includes(sink.id)
                }));
            }
        }
        return result;
    }

    /**
     * Read the standing default sink ids for a content type. Empty when no default
     * is set or no defaults store is configured.
     *
     * @param typeId - The namespaced content type id.
     * @returns The default sink ids.
     */
    async getSinkDefaults(typeId: string): Promise<string[]> {
        return this.sinkDefaults ? this.sinkDefaults.get(typeId) : [];
    }

    /**
     * Set the standing default sink ids for a content type, so an operator
     * redirects a type's default sinks as policy data without a code change.
     *
     * @param typeId - The namespaced content type id.
     * @param sinkIds - The sink ids to pre-select by default.
     * @throws When no defaults store is configured.
     */
    async setSinkDefaults(typeId: string, sinkIds: string[]): Promise<void> {
        if (!this.sinkDefaults) {
            throw new Error('Sink defaults are unavailable; the curation service was constructed without a defaults store.');
        }
        await this.sinkDefaults.set(typeId, sinkIds);

        return;
    }

    /**
     * Record a terminal decision, deliver to any selected sinks, then commit the
     * decision declaratively through the owning type. The decision is persisted
     * (with the selected sinks as `pending`) and broadcast first; sinks are then
     * delivered best-effort and their outcomes recorded; finally the decision
     * commits by writing the type's declared `decisionStatus` word via its
     * `applyEdit({ status })` seam. A commit failure propagates (the item stays
     * decided and won't reappear). `applyEdit` must be retry-safe.
     *
     * @param id - The envelope id.
     * @param status - The terminal state.
     * @param decidedBy - Better Auth user id of the deciding curator.
     * @param sinks - Curator-selected publish sinks (approval only).
     * @returns The decided envelope, or null when the decision cannot proceed.
     * @throws When a selected sink is ineligible (before any decision is
     *         recorded), or when the owning type's `applyEdit` commit fails (after
     *         it is).
     */
    private async decide(
        id: string,
        status: Exclude<CurationItemStatus, 'pending'>,
        decidedBy?: string,
        sinks?: ICurationSinkSelection[]
    ): Promise<ICurationItem | null> {
        const existing = await this.queue.get(id);
        let result: ICurationItem | null = null;
        if (!existing || existing.status !== 'pending') {
            result = null;
        } else {
            const entry = this.types.get(existing.typeId);
            if (!entry) {
                // Disabled owner: the decision is blocked, not lost. The item
                // waits in the queue until its provider re-registers the type.
                this.logger.warn(
                    { id, typeId: existing.typeId },
                    'Curation decision blocked — owning type is not registered'
                );
                result = null;
            } else {
                // Snapshot what the curator actually saw. The pending queue shows
                // a live `describe()` (withLivePreview), but the cached preview on
                // the envelope is the hold-time value unless an inline edit
                // refreshed it. Re-derive here so the terminal write freezes the
                // decision-time view as faithful audit history; fall back to the
                // cached snapshot if `describe()` fails. Passing it into `resolve()`
                // keeps the preview inside the same atomic status gate, so only the
                // winning transition persists it.
                let decisionPreview = existing.preview;
                try {
                    decisionPreview = await entry.type.describe(existing.ref);
                } catch (error) {
                    this.logger.warn({ error, id }, 'Decision-time preview resolution failed; recording cached snapshot in history');
                }
                // Resolve and validate the selected sinks BEFORE recording the
                // decision, so an empty or ineligible selection aborts the approval
                // without leaving the item half-decided. Only an approval routes.
                let selected: IResolvedSink[] = [];
                if (status === 'approved') {
                    // Eligibility is [] for a classic (non-sink) type, so the block
                    // runs for every approval but only ever admits a selection for a
                    // sink type — the boundary is the eligible set, not the flag.
                    const eligible = this.eligiblePublishSinks(entry.type, decisionPreview);
                    // Scoped empty-approval guard: an item with eligible publish
                    // sinks must target at least one — approving with none would
                    // record the decision while publishing nowhere. When zero sinks
                    // are eligible (a classic type, or a sink type whose transports
                    // are all disabled) there is nothing to select, so an empty
                    // approval proceeds and routes nowhere — never a deadlock. This
                    // is the server half of the picker's Approve-button guard.
                    if (eligible.length > 0 && (!sinks || sinks.length === 0)) {
                        throw new Error('This item publishes to sinks; select at least one before approving.');
                    }
                    // Any supplied selection is validated against the eligible set;
                    // for a classic type that set is empty, so a caller that passes
                    // sinks to a non-routing type fails fast here rather than having
                    // the sinks silently dropped.
                    if (sinks && sinks.length > 0) {
                        selected = this.resolveSelectedSinks(eligible, sinks);
                    }
                }
                const pendingOutcomes = selected.length > 0
                    ? selected.map((d): ICurationSinkOutcome => ({ sinkId: d.sink.id, status: 'pending' }))
                    : undefined;
                const resolved = await this.queue.resolve(id, status, decidedBy, decisionPreview, pendingOutcomes);
                if (resolved) {
                    // The decision is recorded; broadcast it before delivering or
                    // committing so the queue badge updates regardless of outcome.
                    await this.notifyChanged();
                    // Hand the selected sinks to durable delivery. When the
                    // syndication service is wired, commit the publish legs to its
                    // transactional outbox: the intent is now durable, the relay
                    // delivers each leg with idempotent retry and dead-lettering,
                    // and the recorded outcomes stay `pending` — live leg state is
                    // overlaid on read. External delivery is asynchronous and must
                    // not block the decision, so the declarative `applyEdit` commit
                    // that follows never waits on where the content lands. Absent
                    // syndication (a test boot), fall back to the in-process best-
                    // effort fan-out, recording settled outcomes inline.
                    if (selected.length > 0) {
                        const syndication = this.syndicationResolver?.();
                        if (syndication) {
                            await syndication.enqueue({
                                originId: id,
                                originKind: 'curation',
                                typeId: existing.typeId,
                                ref: existing.ref,
                                descriptor: decisionPreview,
                                legs: selected.map((d) => ({ sinkId: d.sink.id, dest: d.dest }))
                            });
                        } else {
                            const outcomes = await this.deliverToSinks(decisionPreview, selected);
                            await this.queue.updateSinkOutcomes(id, outcomes);
                            resolved.sinks = outcomes;
                        }
                    }
                    // A commit failure propagates to the caller: the item has left
                    // the pending queue and won't reappear, so the curator must be
                    // told the provider-side effect did not complete.
                    await this.commit(entry.type, resolved);

                    // Canonical content is now live — the approved-status applyEdit
                    // committed above. A rejected decision, or a commit that threw,
                    // never reaches here, so the seam signals only a genuine publish.
                    // Fire the content.published observer so downstream reactors act
                    // on the live record; observer semantics isolate any reactor's
                    // failure from the decision.
                    if (status === 'approved' && this.hookRegistry) {
                        await this.hookRegistry.invoke(HOOKS.content.published, {
                            typeId: existing.typeId,
                            ref: existing.ref,
                            descriptor: decisionPreview
                        });
                    }
                }
                result = resolved;
            }
        }
        return result;
    }

    /**
     * The publish-kind sinks the content router admits for a type given a
     * decision-time descriptor — the single computation behind sink eligibility,
     * shared by the picker (`listEligibleSinks`), the empty-approval guard in
     * `decide`, and selection validation (`resolveSelectedSinks`) so all three
     * agree on what "eligible" means. Empty when the type does not publish to
     * sinks or the router is absent, so a caller renders no picker and the guard
     * treats the item as having nothing to select (no deadlock).
     *
     * @param type - The owning curation type (supplies the classification ceiling).
     * @param descriptor - The decision-time descriptor (supplies present features).
     * @returns The eligible publish sinks, in router order.
     */
    private eligiblePublishSinks(type: ICurationType, descriptor: ICurationItem['preview']): IContentSink[] {
        let sinks: IContentSink[] = [];
        if (type.publishesToSinks && this.contentRouter) {
            const present = presentDescriptorFeatures(descriptor);
            const ceiling = type.classification ?? DEFAULT_CONTENT_CEILING;
            sinks = this.contentRouter.route(ceiling, present).filter((sink) => sink.kind === 'publish');
        }
        return sinks;
    }

    /**
     * Validate a curator's sink selection against the item's already-computed
     * eligible sinks, pairing each with its config. Throwing here — before the
     * decision is recorded — is deliberate: an ineligible or stale selection must
     * abort the approval rather than decide the item and then fail to deliver.
     *
     * @param eligibleSinks - The item's eligible publish sinks (from
     *        {@link eligiblePublishSinks}); the selection is checked against these.
     * @param sinks - The curator's selection.
     * @returns The selected sinks paired with their delivery config.
     * @throws When a selected sink is not among the eligible publish sinks.
     */
    private resolveSelectedSinks(
        eligibleSinks: IContentSink[],
        sinks: ICurationSinkSelection[]
    ): IResolvedSink[] {
        const eligible = new Map(eligibleSinks.map((sink) => [sink.id, sink]));
        // Deduplicate by sinkId: delivery is non-idempotent (each publish leg is a
        // distinct external side effect with no outbox guard), so a repeated sink
        // in the selection would publish twice. Keep the first occurrence to
        // preserve selection order; the picker sends unique entries, but this is a
        // public admin endpoint that accepts arbitrary JSON.
        const seen = new Set<string>();
        const resolved: IResolvedSink[] = [];
        for (const selection of sinks) {
            if (seen.has(selection.sinkId)) {
                continue;
            }
            const sink = eligible.get(selection.sinkId);
            if (!sink) {
                throw new Error(`Sink '${selection.sinkId}' is not an eligible publish sink for this item.`);
            }
            seen.add(selection.sinkId);
            resolved.push({ sink, dest: selection.dest ?? {} });
        }

        return resolved;
    }

    /**
     * Deliver the approved descriptor to each selected publish sink, one leg at a
     * time, recording every outcome. Three terminal states per leg: a resolved
     * `void` is `delivered`; a resolved {@link IContentSinkRefusal} is `refused`
     * (the sink matched structurally but declined to render this content — its
     * reason recorded verbatim, never interpreted); a thrown error is `failed`.
     * Refusal and failure are kept distinct on purpose — a failure is a retryable
     * "could not", a refusal is a settled "will not" — so the audit does not read
     * a deliberate decline as an error. No leg ever throws out of this method, so
     * one sink's outcome neither blocks the others nor undoes the decision. This is
     * the best-effort, at-least-once-per-leg posture curation carries for its
     * inline sink fan-out; the durable outbox relay is the syndication upgrade that
     * supersedes it when wired.
     *
     * @param descriptor - The decision-time descriptor delivered to each sink.
     * @param resolved - The selected sinks paired with their delivery config.
     * @returns One settled outcome per sink, in selection order.
     */
    private async deliverToSinks(
        descriptor: ICurationItem['preview'],
        resolved: IResolvedSink[]
    ): Promise<ICurationSinkOutcome[]> {
        const outcomes: ICurationSinkOutcome[] = [];
        for (const { sink, dest } of resolved) {
            try {
                const result = await sink.deliver(descriptor, dest);
                // A returned refusal is an object carrying `refused: true`; a
                // delivered leg resolves `void`. Narrow on the object shape so the
                // `void` arm of the union is never read as a property access.
                if (typeof result === 'object' && result !== null && result.refused) {
                    outcomes.push({ sinkId: sink.id, status: 'refused', reason: result.reason });
                } else {
                    outcomes.push({ sinkId: sink.id, status: 'delivered' });
                }
            } catch (error) {
                this.logger.error({ error, sinkId: sink.id }, 'Curation sink delivery failed');
                outcomes.push({
                    sinkId: sink.id,
                    status: 'failed',
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }

        return outcomes;
    }

    /**
     * Commit the decision on the owning type — declaratively only. Core resolves
     * the decision to a `decisionStatus` word and writes it through the type's own
     * `applyEdit({ status })` seam, the sole commit seam every decision lands
     * through. `rejected` is always declared, so a rejection always writes its
     * transition; `approved` may be omitted (a `publishesToSinks` type whose routed
     * publish sink carries the approval), in which case no approve-time status is
     * written and the commit is a deliberate no-op. A failure propagates to the
     * caller so the curator learns the provider-side effect did not complete; the
     * decision is already recorded and is not rolled back, so `applyEdit` must be
     * retry-safe.
     *
     * @param type - The owning curation type.
     * @param item - The decided envelope.
     * @returns Resolves once the commit settles; rejects if it throws.
     */
    private async commit(type: ICurationType, item: ICurationItem): Promise<void> {
        const approved = item.status === 'approved';
        const targetStatus = approved ? type.decisionStatus.approved : type.decisionStatus.rejected;
        if (targetStatus) {
            await type.applyEdit(item.ref, { status: targetStatus });
        }
    }

    /**
     * Emit a dashboard refetch signal carrying the current pending count.
     *
     * @returns Resolves once the count is read and broadcast.
     */
    private async notifyChanged(): Promise<void> {
        if (this.broadcast) {
            const count = await this.queue.countPending();
            this.broadcast(CURATIONS_CHANGED_EVENT, { count });
        }
    }
}
