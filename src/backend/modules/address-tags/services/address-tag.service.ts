/**
 * @fileoverview The address-tag service — the single authority over text tags
 * on TRON wallet addresses.
 *
 * Every surface (REST, admin UI, future AI tools and sinks) is a thin wrapper
 * around this service; business logic (validation, normalization, idempotent
 * batch semantics, rename collision collapse) lives only here so all wrappers
 * behave identically. Published on the service registry as `'address-tags'`.
 * Authorization is the caller's responsibility — the HTTP layer gates reads to
 * registered users and mutations to admins; this service trusts its inputs'
 * provenance but still validates their shape.
 *
 * Storage is MongoDB (`module_address-tags_tags`), one document per
 * `(address, tag)` assignment, unique-indexed on the pair. Mongo is chosen
 * over ClickHouse because tags are a mutable CRUD entity set, not an
 * append-only analytics stream.
 */

import type {
    IAddressTag,
    IAddressTagListQuery,
    IAddressTagPair,
    IAddressTagRename,
    IAddressTagSearchQuery,
    IAddressTagService,
    IDatabaseService,
    ISystemLogService
} from '@/types';

/** Physical collection name, following the `module_{id}_{collection}` convention. */
export const ADDRESS_TAGS_COLLECTION = 'module_address-tags_tags';

/** Base58 TRON address shape: 'T' followed by 33 base58 characters. */
const TRON_ADDRESS_PATTERN = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

/** Longest tag text accepted; keeps the vocabulary index-friendly and displayable. */
const MAX_TAG_LENGTH = 64;

/** Hard ceiling on batch sizes so one request cannot stall the collection. */
const MAX_BATCH = 1000;

/** Default and maximum page sizes for vocabulary and search reads. */
const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 1000;

/** Stored document shape for one tag assignment. */
interface IAddressTagDocument {
    address: string;
    tag: string;
    createdAt: Date;
    updatedAt: Date;
}

/** Dependencies injected once at bootstrap. */
export interface IAddressTagServiceDependencies {
    /** Core database service; collection names are manually module-prefixed. */
    database: IDatabaseService;
    /** Module-scoped logger for mutation audit lines. */
    logger: ISystemLogService;
}

/**
 * Singleton implementation of the `IAddressTagService` contract.
 *
 * Follows the repo's `setDependencies()` / `getInstance()` singleton pattern:
 * the service is a public API with one shared state (the tags collection),
 * configured once at bootstrap and consumed as-is by every caller.
 */
export class AddressTagService implements IAddressTagService {
    private static instance: AddressTagService | null = null;

    private readonly database: IDatabaseService;
    private readonly logger: ISystemLogService;

    /**
     * Private so construction can only happen through `setDependencies`,
     * guaranteeing a single shared instance.
     *
     * @param deps - Bootstrap-wired collaborators.
     */
    private constructor(deps: IAddressTagServiceDependencies) {
        this.database = deps.database;
        this.logger = deps.logger;
    }

    /**
     * Wire the singleton's dependencies. First call constructs the instance;
     * later calls are no-ops so tests and bootstrap cannot double-configure.
     *
     * @param deps - Bootstrap-wired collaborators.
     */
    public static setDependencies(deps: IAddressTagServiceDependencies): void {
        if (!AddressTagService.instance) {
            AddressTagService.instance = new AddressTagService(deps);
        }
    }

    /**
     * Retrieve the configured singleton.
     *
     * @returns The shared service instance.
     */
    public static getInstance(): AddressTagService {
        if (!AddressTagService.instance) {
            throw new Error('AddressTagService.setDependencies() must be called before getInstance()');
        }
        return AddressTagService.instance;
    }

    /**
     * Test-only reset so suites can re-wire fresh mocks between cases.
     */
    public static resetForTests(): void {
        AddressTagService.instance = null;
    }

    /**
     * Create the unique pair index and the reverse-lookup index. Called from
     * the module's `init()`; idempotent by Mongo semantics.
     */
    public async ensureIndexes(): Promise<void> {
        await this.database.createIndex(ADDRESS_TAGS_COLLECTION, { address: 1, tag: 1 }, { unique: true });
        await this.database.createIndex(ADDRESS_TAGS_COLLECTION, { tag: 1, address: 1 }, {});
    }

    /** @inheritdoc */
    public async createTags(tags: IAddressTagPair[]): Promise<IAddressTag[]> {
        const pairs = this.normalizePairs(tags);
        if (pairs.length === 0) {
            return [];
        }
        const now = new Date();
        const collection = this.database.getCollection<IAddressTagDocument>(ADDRESS_TAGS_COLLECTION);
        // Upsert per pair: $setOnInsert keeps existing assignments untouched so
        // batch creates are idempotent instead of erroring on duplicates.
        for (const pair of pairs) {
            await collection.updateOne(
                { address: pair.address, tag: pair.tag },
                { $setOnInsert: { ...pair, createdAt: now, updatedAt: now } },
                { upsert: true }
            );
        }
        this.logger.info({ count: pairs.length }, 'Address tags created');
        return this.findPairs(pairs);
    }

    /** @inheritdoc */
    public async getTagsByAddresses(addresses: string[]): Promise<IAddressTag[]> {
        const cleaned = this.normalizeAddresses(addresses);
        if (cleaned.length === 0) {
            return [];
        }
        const collection = this.database.getCollection<IAddressTagDocument>(ADDRESS_TAGS_COLLECTION);
        const docs = await collection.find({ address: { $in: cleaned } }).sort({ address: 1, tag: 1 }).toArray();
        return docs.map((doc) => this.toTag(doc));
    }

    /** @inheritdoc */
    public async getAddressesByTags(tags: string[]): Promise<IAddressTag[]> {
        const cleaned = this.normalizeTagValues(tags);
        if (cleaned.length === 0) {
            return [];
        }
        const collection = this.database.getCollection<IAddressTagDocument>(ADDRESS_TAGS_COLLECTION);
        const docs = await collection.find({ tag: { $in: cleaned } }).sort({ tag: 1, address: 1 }).toArray();
        return docs.map((doc) => this.toTag(doc));
    }

    /** @inheritdoc */
    public async listTags(query?: IAddressTagListQuery): Promise<string[]> {
        const limit = this.clampLimit(query?.limit);
        const filter: Record<string, unknown> = {};
        if (query?.prefix) {
            filter.tag = { $regex: `^${escapeRegex(query.prefix)}` };
        }
        const collection = this.database.getCollection<IAddressTagDocument>(ADDRESS_TAGS_COLLECTION);
        // distinct() has no limit parameter, so sort/limit in an aggregation.
        const rows = await collection.aggregate<{ _id: string }>([
            { $match: filter },
            { $group: { _id: '$tag' } },
            { $sort: { _id: 1 } },
            { $limit: limit }
        ]).toArray();
        return rows.map((row) => row._id);
    }

    /** @inheritdoc */
    public async searchTags(query?: IAddressTagSearchQuery): Promise<IAddressTag[]> {
        const limit = this.clampLimit(query?.limit);
        const skip = Math.max(0, Math.floor(query?.skip ?? 0));
        const filter: Record<string, unknown> = {};
        const search = query?.search?.trim();
        if (search) {
            const pattern = { $regex: escapeRegex(search), $options: 'i' };
            filter.$or = [{ address: pattern }, { tag: pattern }];
        }
        const collection = this.database.getCollection<IAddressTagDocument>(ADDRESS_TAGS_COLLECTION);
        const docs = await collection.find(filter as Partial<IAddressTagDocument>)
            .sort({ address: 1, tag: 1 })
            .skip(skip)
            .limit(limit)
            .toArray();
        return docs.map((doc) => this.toTag(doc));
    }

    /** @inheritdoc */
    public async updateTags(renames: IAddressTagRename[]): Promise<IAddressTag[]> {
        if (renames.length > MAX_BATCH) {
            throw new Error(`Batch exceeds ${MAX_BATCH} renames`);
        }
        const cleaned = renames.map((rename) => ({
            address: this.requireAddress(rename.address),
            oldTag: this.requireTag(rename.oldTag),
            newTag: this.requireTag(rename.newTag)
        }));
        const collection = this.database.getCollection<IAddressTagDocument>(ADDRESS_TAGS_COLLECTION);
        const now = new Date();
        for (const rename of cleaned) {
            if (rename.oldTag === rename.newTag) {
                continue;
            }
            const target = await collection.findOne({ address: rename.address, tag: rename.newTag });
            if (target) {
                // Collision: the destination pair already exists — collapse
                // into it by dropping the old assignment.
                await collection.deleteOne({ address: rename.address, tag: rename.oldTag });
                continue;
            }
            await collection.updateOne(
                { address: rename.address, tag: rename.oldTag },
                { $set: { tag: rename.newTag, updatedAt: now } }
            );
        }
        this.logger.info({ count: cleaned.length }, 'Address tags renamed');
        return this.findPairs(cleaned.map((rename) => ({ address: rename.address, tag: rename.newTag })));
    }

    /** @inheritdoc */
    public async deleteTags(tags: IAddressTagPair[]): Promise<number> {
        const pairs = this.normalizePairs(tags);
        if (pairs.length === 0) {
            return 0;
        }
        const collection = this.database.getCollection<IAddressTagDocument>(ADDRESS_TAGS_COLLECTION);
        let deleted = 0;
        for (const pair of pairs) {
            const result = await collection.deleteOne({ address: pair.address, tag: pair.tag });
            deleted += result.deletedCount ?? 0;
        }
        this.logger.info({ requested: pairs.length, deleted }, 'Address tags deleted');
        return deleted;
    }

    /**
     * Validate and normalize a batch of pairs, deduplicating repeats so bulk
     * upserts never race themselves on the unique index.
     *
     * @param tags - Caller-supplied pairs.
     * @returns Trimmed, validated, deduplicated pairs.
     */
    private normalizePairs(tags: IAddressTagPair[]): IAddressTagPair[] {
        if (tags.length > MAX_BATCH) {
            throw new Error(`Batch exceeds ${MAX_BATCH} pairs`);
        }
        const seen = new Set<string>();
        const result: IAddressTagPair[] = [];
        for (const pair of tags) {
            const address = this.requireAddress(pair.address);
            const tag = this.requireTag(pair.tag);
            const key = `${address} ${tag}`;
            if (!seen.has(key)) {
                seen.add(key);
                result.push({ address, tag });
            }
        }
        return result;
    }

    /**
     * Validate a batch of addresses for read lookups, dropping duplicates.
     *
     * @param addresses - Caller-supplied addresses.
     * @returns Validated distinct addresses.
     */
    private normalizeAddresses(addresses: string[]): string[] {
        if (addresses.length > MAX_BATCH) {
            throw new Error(`Batch exceeds ${MAX_BATCH} addresses`);
        }
        return [...new Set(addresses.map((address) => this.requireAddress(address)))];
    }

    /**
     * Validate a batch of tag values for read lookups, dropping duplicates.
     *
     * @param tags - Caller-supplied tag values.
     * @returns Validated distinct tag values.
     */
    private normalizeTagValues(tags: string[]): string[] {
        if (tags.length > MAX_BATCH) {
            throw new Error(`Batch exceeds ${MAX_BATCH} tags`);
        }
        return [...new Set(tags.map((tag) => this.requireTag(tag)))];
    }

    /**
     * Enforce the base58 TRON address shape; validation failures throw so the
     * HTTP layer can map them to 400s.
     *
     * @param address - Raw caller input.
     * @returns The trimmed, validated address.
     */
    private requireAddress(address: string): string {
        const trimmed = String(address ?? '').trim();
        if (!TRON_ADDRESS_PATTERN.test(trimmed)) {
            throw new Error(`Invalid TRON address: '${trimmed}'`);
        }
        return trimmed;
    }

    /**
     * Enforce tag shape: non-empty trimmed text within the length ceiling, and
     * comma-free. The read surface (`parseList` in the user controller) treats
     * commas as the array delimiter in `?tags=x,y`, so a stored comma-bearing
     * tag would be unretrievable by `/by-tag`; reject it at the write boundary
     * — the single validation authority every write path flows through.
     *
     * @param tag - Raw caller input.
     * @returns The trimmed, validated tag.
     */
    private requireTag(tag: string): string {
        const trimmed = String(tag ?? '').trim();
        if (trimmed.length === 0 || trimmed.length > MAX_TAG_LENGTH) {
            throw new Error(`Invalid tag: must be 1-${MAX_TAG_LENGTH} characters`);
        }
        if (trimmed.includes(',')) {
            throw new Error('Invalid tag: commas are not allowed');
        }
        return trimmed;
    }

    /**
     * Load the stored records for a set of pairs — the uniform return shape
     * for mutations, so callers always receive current persisted state.
     *
     * @param pairs - Already-normalized pairs to load.
     * @returns Stored assignments matching the pairs.
     */
    private async findPairs(pairs: IAddressTagPair[]): Promise<IAddressTag[]> {
        if (pairs.length === 0) {
            return [];
        }
        const collection = this.database.getCollection<IAddressTagDocument>(ADDRESS_TAGS_COLLECTION);
        const docs = await collection.find({ $or: pairs.map((pair) => ({ address: pair.address, tag: pair.tag })) })
            .sort({ address: 1, tag: 1 })
            .toArray();
        return docs.map((doc) => this.toTag(doc));
    }

    /**
     * Clamp a caller-supplied page size into the allowed window.
     *
     * @param limit - Raw caller input, possibly absent.
     * @returns A safe positive limit.
     */
    private clampLimit(limit?: number): number {
        const value = Math.floor(limit ?? DEFAULT_LIST_LIMIT);
        if (!Number.isFinite(value) || value < 1) {
            return DEFAULT_LIST_LIMIT;
        }
        return Math.min(value, MAX_LIST_LIMIT);
    }

    /**
     * Project a stored document onto the public record shape, stripping any
     * storage-only fields (`_id`).
     *
     * @param doc - Stored assignment document.
     * @returns The public tag record.
     */
    private toTag(doc: IAddressTagDocument): IAddressTag {
        return { address: doc.address, tag: doc.tag, createdAt: doc.createdAt, updatedAt: doc.updatedAt };
    }
}

/**
 * Escape regex metacharacters in user-supplied search text so it matches
 * literally (and cannot construct a pathological pattern).
 *
 * @param text - Raw search or prefix text.
 * @returns The escaped pattern fragment.
 */
function escapeRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
