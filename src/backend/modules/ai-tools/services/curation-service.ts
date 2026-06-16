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
     * @param input - The type id, opaque ref, and optional attribution.
     * @returns The stored pending envelope.
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
        return item;
    }

    /**
     * List pending envelopes newest-first for the admin queue.
     *
     * @param limit - Maximum envelopes to return.
     * @returns The pending envelopes.
     */
    async listPending(limit?: number): Promise<ICurationItem[]> {
        return this.queue.listPending(limit);
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
     * Fetch one envelope by id.
     *
     * @param id - The envelope id.
     * @returns The envelope, or null when absent.
     */
    async get(id: string): Promise<ICurationItem | null> {
        return this.queue.get(id);
    }

    /**
     * Approve a pending envelope, then commit it through the owning type.
     *
     * @param id - The envelope id.
     * @param decidedBy - Better Auth user id of the deciding curator.
     * @returns The decided envelope, or null when blocked (missing, no longer
     *          pending, or owner unregistered).
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
                await entry.type.applyEdit(existing, patch);
                const preview = await entry.type.describe(existing.ref);
                await this.queue.updatePreview(id, preview);
                await this.notifyChanged();
                this.logger.info({ id, typeId: existing.typeId, editedBy }, 'Curation item edited');
                result = { ...existing, preview };
            }
        }
        return result;
    }

    /**
     * Record a terminal decision and invoke the owning type's callback. The
     * decision is persisted before the callback runs, so a callback failure
     * leaves the item decided (the contract requires callbacks be retry-safe)
     * rather than re-opening an effect that may already have partly committed.
     *
     * @param id - The envelope id.
     * @param status - The terminal state.
     * @param decidedBy - Better Auth user id of the deciding curator.
     * @returns The decided envelope, or null when the decision cannot proceed.
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
                    await this.commit(entry.type, resolved);
                    await this.notifyChanged();
                }
                result = resolved;
            }
        }
        return result;
    }

    /**
     * Invoke the owning type's terminal callback, isolating its failure from the
     * already-recorded decision.
     *
     * @param type - The owning curation type.
     * @param item - The decided envelope.
     * @returns Resolves once the callback settles.
     */
    private async commit(type: ICurationType, item: ICurationItem): Promise<void> {
        try {
            if (item.status === 'approved') {
                await type.onApprove(item);
            } else {
                await type.onReject(item);
            }
        } catch (error) {
            this.logger.error(
                { error, id: item.id, typeId: item.typeId, status: item.status },
                'Curation type callback threw after decision recorded'
            );
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
