/**
 * @file curation-service.ts
 *
 * The central curation service: the registry of reviewable content types and
 * the orchestration of the held-item lifecycle. It is the single `'curation'`
 * service core publishes. Providers register a type (describe / onApprove /
 * onReject); producers `hold()` effects into the queue; the admin surface lists
 * and decides them. Core owns the decision and the envelope; the owning type
 * owns the payload, the preview, and what approval does.
 *
 * Decision flow records the terminal state first (the queue's atomic gate),
 * then invokes the owning type's callback. A disabled owner — its type no longer
 * registered — blocks the decision rather than dropping the effect, so a held
 * item simply waits for its provider to return.
 */

import { randomUUID } from 'node:crypto';
import type {
    ICurationEditPatch,
    ICurationHoldInput,
    ICurationItem,
    ICurationService,
    ICurationType,
    ICurationTypeInfo,
    ISystemLogService,
    CurationItemStatus
} from '@/types';
import { shouldAutoApproveCuration } from './curation-auto-approve-context.js';
import type { CurationQueue } from './curation-queue.js';

/** A registered type with the id of the provider that owns it. */
interface IRegisteredType {
    type: ICurationType;
    providerId: string;
}

/** Broadcast sink for dashboard refetch signals (a no-op until wired). */
type BroadcastFn = (event: string, payload: unknown) => void;

/** WebSocket event the dashboard listens on to refetch the queue. */
export const CURATIONS_CHANGED_EVENT = 'ai-tools:curations-changed';

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

    /**
     * @param logger - Module-scoped logger.
     * @param queue - Persistent store of curation envelopes.
     */
    constructor(
        private readonly logger: ISystemLogService,
        private readonly queue: CurationQueue
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
     * Register a reviewable content type. A later registration for the same id
     * replaces the earlier one (an operator re-enabling a provider).
     *
     * @param type - The type contract.
     * @param providerId - Id of the registering plugin or module.
     */
    registerType(type: ICurationType, providerId: string): void {
        this.types.set(type.typeId, { type, providerId });
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
     * immediately under {@link CURATION_AUTO_APPROVE_DECIDED_BY}, running the
     * owning type's `onApprove` before this returns. A bypass that fails to
     * commit propagates exactly as a manual approval's failure would.
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
        let result = item;
        if (shouldAutoApproveCuration()) {
            this.logger.info({ id: item.id, typeId: item.typeId }, 'Curation auto-approved by tool policy (interactive bypass)');
            const approved = await this.approve(item.id, CURATION_AUTO_APPROVE_DECIDED_BY);
            result = approved ?? item;
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
     * Fetch one envelope by id, resolving a live preview while it is pending and
     * its owner is registered.
     *
     * @param id - The envelope id.
     * @returns The envelope, or null when absent.
     */
    async get(id: string): Promise<ICurationItem | null> {
        const item = await this.queue.get(id);
        return item && item.status === 'pending' ? this.withLivePreview(item) : item;
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
     * Approve a pending envelope, then commit it through the owning type.
     *
     * @param id - The envelope id.
     * @param decidedBy - Better Auth user id of the deciding curator.
     * @returns The decided envelope, or null when blocked (missing, no longer
     *          pending, or owner unregistered).
     * @throws When the owning type's `onApprove` fails; the decision is still
     *         recorded, so the caller surfaces the failure rather than retrying.
     */
    async approve(id: string, decidedBy?: string): Promise<ICurationItem | null> {
        return this.decide(id, 'approved', decidedBy);
    }

    /**
     * Reject a pending envelope, then discard it through the owning type.
     *
     * @param id - The envelope id.
     * @param decidedBy - Better Auth user id of the deciding curator.
     * @returns The decided envelope, or null under the same conditions as approve.
     * @throws When the owning type's `onReject` fails; the decision is still
     *         recorded.
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
                    await entry.type.applyEdit(latest, patch);
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
     * Record a terminal decision and invoke the owning type's callback. The
     * decision is persisted and broadcast before the callback runs; a callback
     * failure then propagates to the caller (the item stays decided and won't
     * reappear, so the curator is told the provider-side effect failed rather than
     * seeing a false success). Callbacks must be retry-safe.
     *
     * @param id - The envelope id.
     * @param status - The terminal state.
     * @param decidedBy - Better Auth user id of the deciding curator.
     * @returns The decided envelope, or null when the decision cannot proceed.
     * @throws When the owning type's callback fails after the decision is recorded.
     */
    private async decide(
        id: string,
        status: Exclude<CurationItemStatus, 'pending'>,
        decidedBy?: string
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
                const resolved = await this.queue.resolve(id, status, decidedBy);
                if (resolved) {
                    // The decision is recorded; broadcast it before committing so
                    // the queue badge updates regardless of the commit outcome.
                    await this.notifyChanged();
                    // A commit failure propagates to the caller: the item has left
                    // the pending queue and won't reappear, so the curator must be
                    // told the provider-side effect did not complete.
                    await this.commit(entry.type, resolved);
                }
                result = resolved;
            }
        }
        return result;
    }

    /**
     * Invoke the owning type's terminal callback. A failure propagates to the
     * caller so the curator learns the provider-side effect did not complete; the
     * decision is already recorded and is not rolled back (callbacks must be
     * retry-safe).
     *
     * @param type - The owning curation type.
     * @param item - The decided envelope.
     * @returns Resolves once the callback settles; rejects if it throws.
     */
    private async commit(type: ICurationType, item: ICurationItem): Promise<void> {
        if (item.status === 'approved') {
            await type.onApprove(item);
        } else {
            await type.onReject(item);
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
