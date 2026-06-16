/**
 * @file curation-queue.ts
 *
 * Persistent store for the central curation queue — the envelopes of effects
 * held for a human curator's decision. It is the storage half of the curation
 * subsystem: execution-free, like the approval queue it sits beside. It records
 * a held item and its decision; the owning curation type (not this store) owns
 * what "approved" does. Generalizes each plugin's private pending queue into one
 * core-owned collection so a single admin surface reviews every content type.
 */

import type {
    CurationItemStatus,
    ICurationItem,
    ICurationPreview,
    IDatabaseService,
    ISystemLogService
} from '@/types';

/** Physical collection name (modules prefix `module_<id>_` manually). */
const COLLECTION = 'module_ai-tools_curations';

/**
 * Persistent store of curation envelopes awaiting or carrying a decision.
 */
export class CurationQueue {
    /**
     * @param logger - Module-scoped logger.
     * @param database - Core database owning the curations collection.
     */
    constructor(
        private readonly logger: ISystemLogService,
        private readonly database: IDatabaseService
    ) {}

    /**
     * Create the collection's indexes. Called once during module init.
     *
     * @returns Resolves when all indexes exist.
     */
    async ensureIndexes(): Promise<void> {
        await this.database.createIndex(COLLECTION, { id: 1 }, { unique: true });
        await this.database.createIndex(COLLECTION, { status: 1, createdAt: -1 });
        await this.database.createIndex(COLLECTION, { typeId: 1, status: 1 });
    }

    /**
     * Persist a held envelope in its `pending` state.
     *
     * @param item - The envelope to store.
     * @returns The stored envelope.
     */
    async insert(item: ICurationItem): Promise<ICurationItem> {
        await this.database.insertOne(COLLECTION, item);
        this.logger.info({ id: item.id, typeId: item.typeId }, 'Curation item held for review');
        return item;
    }

    /**
     * Fetch one envelope by id.
     *
     * @param id - The envelope id.
     * @returns The envelope, or null when not found.
     */
    async get(id: string): Promise<ICurationItem | null> {
        return this.database.findOne<ICurationItem>(COLLECTION, { id });
    }

    /**
     * List pending envelopes, newest first.
     *
     * @param limit - Maximum envelopes to return (default 100, capped at 500).
     * @returns The pending envelopes.
     */
    async listPending(limit = 100): Promise<ICurationItem[]> {
        const capped = Math.min(Math.max(1, limit), 500);
        const collection = this.database.getCollection<ICurationItem>(COLLECTION);
        return collection
            .find({ status: 'pending' })
            .sort({ createdAt: -1 })
            .limit(capped)
            .toArray();
    }

    /**
     * Count envelopes still awaiting a decision, for the dashboard badge.
     *
     * @returns The number of `pending` envelopes.
     */
    async countPending(): Promise<number> {
        return this.database.count(COLLECTION, { status: 'pending' });
    }

    /**
     * Replace a pending envelope's cached preview after an inline edit, so the
     * disabled-owner fallback snapshot stays current. Scoped to `pending` so a
     * decided item is never mutated.
     *
     * @param id - The envelope id.
     * @param preview - The freshly re-derived preview.
     * @returns Resolves when the update settles.
     */
    async updatePreview(id: string, preview: ICurationPreview): Promise<void> {
        await this.database.updateMany(COLLECTION, { id, status: 'pending' }, { $set: { preview } });
    }

    /**
     * Transition a pending envelope to `approved` or `rejected`. The conditional
     * update on `status: 'pending'` is the atomic gate: two concurrent decisions
     * serialize on the document, so only the first transitions it and gets the
     * envelope back, ensuring the owning type's callback runs exactly once.
     *
     * @param id - The envelope id.
     * @param status - The terminal state.
     * @param decidedBy - Better Auth user id of the deciding curator.
     * @returns The updated envelope, or null when no pending envelope matched.
     */
    async resolve(
        id: string,
        status: Exclude<CurationItemStatus, 'pending'>,
        decidedBy?: string
    ): Promise<ICurationItem | null> {
        const existing = await this.database.findOne<ICurationItem>(COLLECTION, { id, status: 'pending' });
        let resolved: ICurationItem | null = null;
        if (existing) {
            const decidedAt = new Date();
            const setFields: Partial<ICurationItem> = { status, decidedAt };
            if (decidedBy !== undefined) {
                setFields.decidedBy = decidedBy;
            }
            const modified = await this.database.updateMany(COLLECTION, { id, status: 'pending' }, { $set: setFields });
            if (modified > 0) {
                resolved = { ...existing, status, decidedAt, decidedBy };
                this.logger.info({ id, status, decidedBy }, `Curation item ${status}: ${existing.typeId}`);
            }
        }
        return resolved;
    }
}
