/**
 * @file curation-destination-defaults.ts
 *
 * Standing admin policy for a content type's default publish destinations — the
 * coarse layer beneath the per-item human selection. An operator saves a default
 * subset of sink ids for a type, and the curation destination picker pre-checks
 * them on every future item of that type; the curator still confirms or overrides
 * per item. This is the "redirect a whole type's destinations as data, without a
 * code change" lever the content-routing design calls for, kept deliberately
 * small: a per-type list of sink ids, nothing more.
 *
 * It is a utility, not an `IXxxService` — each curation service constructs its
 * own — so it follows the module's plain-store pattern (like the queue) rather
 * than the singleton service pattern.
 */

import type { IDatabaseService, ISystemLogService } from '@/types';

/** Physical collection name (modules prefix `module_<id>_` manually). */
const COLLECTION = 'module_curation_destination_defaults';

/** One persisted default-destinations row, keyed by content type id. */
interface IDestinationDefaultsDocument {
    /** The content type these defaults apply to. */
    typeId: string;

    /** The sink ids the picker pre-selects for this type. */
    sinkIds: string[];

    /** When the defaults were last written. */
    updatedAt: Date;
}

/**
 * Persistent per-type default publish-destination policy.
 */
export class CurationDestinationDefaults {
    /**
     * @param logger - Module-scoped logger.
     * @param database - Core database owning the defaults collection.
     */
    constructor(
        private readonly logger: ISystemLogService,
        private readonly database: IDatabaseService
    ) {}

    /**
     * Create the collection's unique index. Called once during module init so a
     * type has at most one defaults row.
     *
     * @returns Resolves when the index exists.
     */
    async ensureIndexes(): Promise<void> {
        await this.database.createIndex(COLLECTION, { typeId: 1 }, { unique: true });

        return;
    }

    /**
     * Read the default destination sink ids for a content type.
     *
     * @param typeId - The namespaced content type id.
     * @returns The stored default sink ids, or an empty array when none is set.
     */
    async get(typeId: string): Promise<string[]> {
        const doc = await this.database.findOne<IDestinationDefaultsDocument>(COLLECTION, { typeId });

        return doc?.sinkIds ?? [];
    }

    /**
     * Replace the default destination sink ids for a content type — the first
     * save creates the row, later saves overwrite it, so a type has one defaults
     * row mutated in place. Implemented as find-then-update/insert (rather than a
     * single upsert) so it relies only on the convenience methods every
     * `IDatabaseService` — including the test mock — supports; the unique `typeId`
     * index is the backstop against a concurrent double-insert.
     *
     * @param typeId - The namespaced content type id.
     * @param sinkIds - The sink ids to pre-select by default.
     * @returns Resolves when the defaults are persisted.
     */
    async set(typeId: string, sinkIds: string[]): Promise<void> {
        const existing = await this.database.findOne<IDestinationDefaultsDocument>(COLLECTION, { typeId });
        if (existing) {
            await this.database.updateMany(COLLECTION, { typeId }, { $set: { sinkIds, updatedAt: new Date() } });
        } else {
            await this.database.insertOne(COLLECTION, { typeId, sinkIds, updatedAt: new Date() });
        }
        this.logger.info({ typeId, sinkIds }, 'Curation destination defaults set');

        return;
    }
}
