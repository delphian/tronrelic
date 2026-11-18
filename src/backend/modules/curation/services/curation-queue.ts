/**
 * @file curation-queue.ts
 *
 * Persistent store for the central curation queue — the envelopes of effects
 * held for a human curator's decision. It is the storage half of the curation
 * subsystem: execution-free. It records a held item and its decision; the owning
 * curation type (not this store) owns what "approved" does. Generalizes each
 * plugin's private pending queue into one core-owned collection so a single
 * admin surface reviews every content type.
 */

import type {
    CurationItemStatus,
    IContentChangeSet,
    ICurationHistoryListOptions,
    ICurationSinkOutcome,
    ICurationItem,
    ICurationPreview,
    IDatabaseService,
    ISystemLogService
} from '@/types';
import { CURATION_DECISIONS } from '@/types';

/** Physical collection name (modules prefix `module_<id>_` manually). */
const COLLECTION = 'module_curation_curations';

/** Most decided items one history read returns, whatever the caller asks for. */
const MAX_HISTORY_PAGE = 100;

/**
 * Hold a paging number to a whole number within bounds, so a read never runs
 * unbounded or with a negative skip even when the caller passed a bad value.
 *
 * @param value - The number the caller asked for.
 * @param min - The smallest value allowed, also used for a value that is not finite.
 * @param max - The largest value allowed.
 * @returns The bounded whole number.
 */
function clampInteger(value: number, min: number, max: number): number {
    const whole = Number.isFinite(value) ? Math.trunc(value) : min;
    return Math.min(max, Math.max(min, whole));
}

/**
 * The optional parts of a decision, written in the same atomic update as the
 * status change. Named rather than positional because most callers set only
 * a few of them.
 */
export interface ICurationResolution {
    /** Better Auth user id of the deciding curator. */
    decidedBy?: string;

    /** Decision-time preview to freeze into history; absent keeps the cached snapshot. */
    preview?: ICurationPreview;

    /** Decision-time comparison with the live version, frozen into history. */
    changes?: IContentChangeSet;

    /**
     * Selected sinks, recorded `pending` so the publish intent commits with the
     * decision and is never lost to a crash before the delivery relay runs.
     */
    sinks?: ICurationSinkOutcome[];

    /** Why a `dismissed` item was closed, so history never shows a dismissal without its reason. */
    dismissReason?: string;
}

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
     * `{ status, decidedAt }` serves the history unfiltered or filtered by
     * decision. `{ typeId, status, decidedAt }` serves it filtered by content
     * type, newest decision first, and its `{ typeId, status }` prefix serves
     * every lookup by type and status. It replaced a two-field
     * `{ typeId, status }` index, which a deployment created before the change
     * still holds and can drop.
     *
     * @returns Resolves when all indexes exist.
     */
    async ensureIndexes(): Promise<void> {
        await this.database.createIndex(COLLECTION, { id: 1 }, { unique: true });
        await this.database.createIndex(COLLECTION, { status: 1, createdAt: -1 });
        await this.database.createIndex(COLLECTION, { typeId: 1, status: 1, decidedAt: -1 });
        await this.database.createIndex(COLLECTION, { status: 1, decidedAt: -1 });
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
     * List one page of closed envelopes (approved, rejected, or dismissed),
     * most-recently-closed first, with the number matching across every page.
     * The records were never discarded — a decision mutates an item in place
     * rather than deleting it (see `resolve`) — so this is the audit half of the
     * queue: who decided what, and when.
     *
     * The history grows without bound, so it is read one page at a time. The
     * sort is `decidedAt` alone so the `{ status, decidedAt }` and
     * `{ typeId, status, decidedAt }` indexes supply the order; a tiebreaker
     * outside the index would make MongoDB sort every decided item in memory.
     *
     * @param options - Paging and filters. `limit` is held to 1–100 and `skip`
     *   to zero or more, so a caller that skipped validation still gets a
     *   bounded read.
     * @returns The page of decided envelopes, newest decision first, and the
     *   number of envelopes the filters match.
     */
    async listHistory(options: ICurationHistoryListOptions): Promise<{ items: ICurationItem[]; total: number }> {
        const limit = clampInteger(options.limit, 1, MAX_HISTORY_PAGE);
        const skip = clampInteger(options.skip, 0, Number.MAX_SAFE_INTEGER);
        const filter: Record<string, unknown> = {
            status: options.decision ?? { $in: [...CURATION_DECISIONS] }
        };
        if (options.typeId) {
            filter.typeId = options.typeId;
        }
        const collection = this.database.getCollection<ICurationItem>(COLLECTION);
        const [items, total] = await Promise.all([
            collection.find(filter).sort({ decidedAt: -1 }).skip(skip).limit(limit).toArray(),
            collection.countDocuments(filter)
        ]);
        return { items, total };
    }

    /**
     * List the content type of every decided envelope, once each, so the
     * history's type filter offers only types that have decisions, including
     * types whose owning plugin has since been removed.
     *
     * Read on every history request. Decided items run to thousands rather
     * than millions, and the `{ status, decidedAt }` index narrows the match to
     * decided items, so the grouping costs milliseconds.
     *
     * @returns The distinct type ids, in no particular order.
     */
    async listHistoryTypeIds(): Promise<string[]> {
        const collection = this.database.getCollection<ICurationItem>(COLLECTION);
        const rows = await collection
            .aggregate<{ _id: unknown }>([
                { $match: { status: { $in: [...CURATION_DECISIONS] } } },
                { $group: { _id: '$typeId' } }
            ])
            .toArray();
        return rows
            .map((row) => row._id)
            .filter((typeId): typeId is string => typeof typeId === 'string' && typeId.length > 0);
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
     * Transition a pending envelope to `approved`, `rejected`, or `dismissed`.
     * The conditional update on `status: 'pending'` is the atomic gate: two
     * concurrent decisions serialize on the document, so only the first
     * transitions it and gets the envelope back, ensuring the owning type's
     * callback runs exactly once. Everything in `details` is written in that
     * same update, so only the winning transition records it.
     *
     * @param id - The envelope id.
     * @param status - The terminal state.
     * @param details - Who decided, and the decision-time record to freeze.
     * @returns The updated envelope, or null when no pending envelope matched.
     */
    async resolve(
        id: string,
        status: Exclude<CurationItemStatus, 'pending'>,
        details: ICurationResolution = {}
    ): Promise<ICurationItem | null> {
        const { decidedBy, preview, changes, sinks, dismissReason } = details;
        const existing = await this.database.findOne<ICurationItem>(COLLECTION, { id, status: 'pending' });
        let resolved: ICurationItem | null = null;
        if (existing) {
            const decidedAt = new Date();
            const setFields: Partial<ICurationItem> = { status, decidedAt };
            if (decidedBy !== undefined) {
                setFields.decidedBy = decidedBy;
            }
            // Freeze the decision-time preview into the same atomic update as the
            // status transition, so history shows exactly what the curator decided
            // on and only the winning transition persists it. The service supplies
            // it (the queue has no type registry); absent, the cached snapshot stands.
            if (preview !== undefined) {
                setFields.preview = preview;
            }
            if (changes !== undefined) {
                setFields.changes = changes;
            }
            // Persist the selected sinks (each `pending`) inside the same atomic
            // transition, so the publish intent and the decision commit together —
            // the dual-write gap closed at the decision boundary.
            if (sinks !== undefined) {
                setFields.sinks = sinks;
            }
            if (dismissReason !== undefined) {
                setFields.dismissReason = dismissReason;
            }
            const modified = await this.database.updateMany(COLLECTION, { id, status: 'pending' }, { $set: setFields });
            if (modified > 0) {
                resolved = {
                    ...existing,
                    status,
                    decidedAt,
                    decidedBy,
                    preview: preview ?? existing.preview,
                    changes: changes ?? existing.changes,
                    sinks: sinks ?? existing.sinks,
                    dismissReason: dismissReason ?? existing.dismissReason
                };
                this.logger.info({ id, status, decidedBy }, `Curation item ${status}: ${existing.typeId}`);
            }
        }
        return resolved;
    }

    /**
     * Record the per-sink delivery outcomes after the relay has run, replacing
     * the `pending` sinks written at decision time. Scoped to an already-
     * `approved` item so a concurrent re-decision cannot have it overwrite a
     * different lifecycle state.
     *
     * @param id - The envelope id.
     * @param sinks - The settled outcomes (delivered/failed per sink).
     * @returns Resolves when the outcomes are persisted.
     */
    async updateSinkOutcomes(id: string, sinks: ICurationSinkOutcome[]): Promise<void> {
        await this.database.updateMany(COLLECTION, { id, status: 'approved' }, { $set: { sinks } });

        return;
    }
}
