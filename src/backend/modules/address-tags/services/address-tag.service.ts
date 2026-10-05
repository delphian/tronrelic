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
    IAddressTagAssertion,
    IAddressTagCount,
    IAddressTagGroup,
    IAddressTagListQuery,
    IAddressTagPair,
    IAddressTagRename,
    IAddressTagSearchQuery,
    IAddressTagService,
    IAddressTagSource,
    IAddressTagSummary,
    IAddressTagSummaryQuery,
    IAddressTagSyncResult,
    IDatabaseService,
    ISystemLogService
} from '@/types';

/** Physical collection name, following the `module_{id}_{collection}` convention. */
export const ADDRESS_TAGS_COLLECTION = 'module_address-tags_tags';

/**
 * Tag-text prefixes reserved for machine ingestion sources. A human write
 * whose tag starts with one of these is rejected so an operator cannot forge
 * a source's assertion (an `ofac:sdn` tag with no OFAC provenance behind it);
 * only `syncSource` writes them. Matching is case-insensitive because tags are
 * stored as typed, and `OFAC:sdn` would otherwise slip past the guard while
 * reading identically to the reserved form.
 */
export const RESERVED_TAG_PREFIXES: readonly string[] = ['ofac:', 'usdt:', 'chainalysis:'];

/** Base58 TRON address shape: 'T' followed by 33 base58 characters. */
const TRON_ADDRESS_PATTERN = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

/** Longest tag text accepted; keeps the vocabulary index-friendly and displayable. */
const MAX_TAG_LENGTH = 64;

/**
 * Recorded as the actor on a mutation log line when the caller named no one,
 * so a missing attribution reads as missing rather than as a blank field. The
 * MCP module records the same word for the same case.
 */
const UNATTRIBUTED_ACTOR = 'unattributed';

/** Hard ceiling on batch sizes so one request cannot stall the collection. */
const MAX_BATCH = 1000;

/** Default and maximum page sizes for vocabulary and search reads. */
const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 1000;

/**
 * Stored document shape for one tag assignment. The provenance fields are
 * optional at the type level because documents written before the
 * `001_add_provenance_fields` migration lack them entirely; every write path
 * here sets them, and `toTag` defaults absent fields to the migration's
 * interpretation (a legacy document was typed by an admin, so it is a live
 * manual tag with no sources).
 */
interface IAddressTagDocument {
    address: string;
    tag: string;
    createdAt: Date;
    updatedAt: Date;
    /** True when a human asserted this tag. */
    manual?: boolean;
    /** Denormalized liveness: `manual`, or any source element not withdrawn. */
    active?: boolean;
    /** Machine sources that have asserted this pair, withdrawn or live. */
    sources?: IAddressTagSource[];
}

/**
 * One pair's outcome in a `createTags` batch, recorded on the
 * `Address tags created` log line so an operator reading `/system/logs` can
 * see exactly which assignments a create added, rather than only how many
 * pairs the request carried.
 */
interface IAddressTagCreateLogEntry {
    address: string;
    tag: string;
    /**
     * `created` — a new document was stored; `claimed` — a document only a
     * machine source asserted gained the human claim; `unchanged` — a human
     * already claimed the pair.
     */
    outcome: 'created' | 'claimed' | 'unchanged';
    /** Claim flags on the document before this write, or null when it did not exist. */
    previous: { manual: boolean; active: boolean } | null;
    /** Human-claim flag written by the create; always true, recorded so the line states what was set. */
    manual: boolean;
    /** Liveness written by the create; always true because a human claim makes a tag live. */
    active: boolean;
    /** When the pair was first stored, which is now for a `created` pair. */
    createdAt: Date;
    /** Machine source elements already on the document, which a create leaves untouched. */
    sources: IAddressTagSource[];
}

/**
 * One instruction's outcome in an `updateTags` batch, recorded on the
 * `Address tags renamed` log line. A rename can move a document in place,
 * move only the human claim, or do nothing, and the log has to say which,
 * because the old tag text survives the rename when a machine source still
 * cites it.
 */
interface IAddressTagRenameLogEntry {
    address: string;
    oldTag: string;
    newTag: string;
    /**
     * `renamed` — the document moved to the new tag in place;
     * `claim-moved` — the human claim moved to the new-tag document, because
     * that document already existed or the old document carries machine
     * sources; `skipped-missing` — no document held the old tag;
     * `skipped-same` — the old and new tag text were identical.
     */
    outcome: 'renamed' | 'claim-moved' | 'skipped-missing' | 'skipped-same';
    /** When the document now carrying the new tag was first stored; set when a write happened. */
    createdAt?: Date;
    /** Whether the new-tag document existed before the rename; set for `claim-moved`. */
    destinationExisted?: boolean;
    /** Machine source elements on the new-tag document; set for `claim-moved`. */
    destinationSources?: IAddressTagSource[];
    /** What happened to the old-tag document; set for `claim-moved`. */
    oldDocument?: 'deleted' | 'kept';
    /** Liveness of the old-tag document after its human claim was cleared; set for `claim-moved`. */
    oldDocumentActive?: boolean;
    /** Machine source elements that stay with the old tag text; set for `claim-moved`. */
    oldDocumentSources?: IAddressTagSource[];
}

/**
 * One pair's outcome in a `deleteTags` batch, recorded on the
 * `Address tags deleted` log line. A delete removes the document only when a
 * human claim is all it holds, so the log records whether the pair is gone or
 * still stored for a machine source's audit trail.
 */
interface IAddressTagDeleteLogEntry {
    address: string;
    tag: string;
    /**
     * `deleted` — the document held only the human claim and was removed;
     * `claim-cleared` — the human claim was removed and the document stays for
     * its machine sources; `no-human-claim` — only machine sources assert the
     * pair, so nothing a reader can see changed; `not-found` — no document held
     * the pair.
     */
    outcome: 'deleted' | 'claim-cleared' | 'no-human-claim' | 'not-found';
    /** When the pair was first stored; absent when it was not found. */
    createdAt?: Date;
    /** Liveness after the write; false for a deleted document, absent when not found. */
    active?: boolean;
    /** Machine source elements the document carried; absent when not found. */
    sources?: IAddressTagSource[];
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
     * Create the unique pair index, the reverse-lookup index, and the
     * per-source holdings index. Called from the module's `init()`; idempotent
     * by Mongo semantics.
     *
     * The reverse index folds `active` in after `tag` because one popular tag
     * can carry many addresses, so the liveness filter phase 1b adds must be
     * answerable from the index there. The address-led pair index stays
     * unwidened: an address carries a handful of tags at most, so filtering
     * `active` out of those few documents costs nothing. The multikey
     * `sources.id` index exists so a reconcile can load one source's holdings
     * without scanning the collection. The old `{ tag, address }` index is
     * dropped by the `001_add_provenance_fields` migration rather than here,
     * because index removal on a populated production collection belongs on
     * the operator's clock like every other migration.
     */
    public async ensureIndexes(): Promise<void> {
        await this.database.createIndex(ADDRESS_TAGS_COLLECTION, { address: 1, tag: 1 }, { unique: true });
        await this.database.createIndex(ADDRESS_TAGS_COLLECTION, { tag: 1, active: 1, address: 1 }, {});
        await this.database.createIndex(ADDRESS_TAGS_COLLECTION, { 'sources.id': 1, address: 1 }, {});
    }

    /**
     * Count documents the `001_add_provenance_fields` migration has not yet
     * stamped. The module's `init()` logs an error naming that migration when
     * this is non-zero, because once the phase 1b liveness filter ships, a
     * collection with unstamped documents renders a blank tag surface that is
     * otherwise indistinguishable from an empty collection.
     *
     * @returns How many stored assignments still lack the `active` field.
     */
    public async countDocumentsMissingProvenance(): Promise<number> {
        const collection = this.database.getCollection<IAddressTagDocument>(ADDRESS_TAGS_COLLECTION);
        return collection.countDocuments({ active: { $exists: false } });
    }

    /** @inheritdoc */
    public async createTags(tags: IAddressTagPair[], actor?: string): Promise<IAddressTag[]> {
        const pairs = this.normalizePairs(tags);
        let stored: IAddressTag[] = [];
        if (pairs.length > 0) {
            const now = new Date();
            const collection = this.database.getCollection<IAddressTagDocument>(ADDRESS_TAGS_COLLECTION);
            // The prior state is read before the upserts so the log line can
            // say which pairs were new, which gained a human claim on a
            // document only a machine source asserted, and which machine
            // sources were already on each document.
            const prior = await this.findPairDocuments(pairs);
            const priorByKey = new Map(prior.map((doc) => [this.pairKey(doc.address, doc.tag), doc]));
            const changes: IAddressTagCreateLogEntry[] = [];
            // Upsert per pair. Timestamps and the empty sources array ride
            // $setOnInsert so existing assignments stay untouched and batch
            // creates remain idempotent. The claim flags ride $set because a
            // human is asserting the pair either way: if a machine source
            // created the document first, the operator's claim must still be
            // recorded, or a later source withdrawal would hide a tag a human
            // explicitly typed. `manual: true` forces `active: true` by the
            // derivation rule, so the two are always written together.
            for (const pair of pairs) {
                await collection.updateOne(
                    { address: pair.address, tag: pair.tag },
                    {
                        $set: { manual: true, active: true },
                        $setOnInsert: { ...pair, createdAt: now, updatedAt: now, sources: [] }
                    },
                    { upsert: true }
                );
                changes.push(this.describeCreate(pair, priorByKey.get(this.pairKey(pair.address, pair.tag)), now));
            }
            this.logger.info({ actor: actor ?? UNATTRIBUTED_ACTOR, requested: pairs.length, changes }, 'Address tags created');
            stored = await this.findPairs(pairs);
        }
        return stored;
    }

    /** @inheritdoc */
    public async getTagsByAddresses(addresses: string[]): Promise<IAddressTag[]> {
        const cleaned = this.normalizeAddresses(addresses);
        if (cleaned.length === 0) {
            return [];
        }
        const collection = this.database.getCollection<IAddressTagDocument>(ADDRESS_TAGS_COLLECTION);
        // The `active: true` equality is the liveness filter (phase 1b): a
        // withdrawn machine tag stays stored for audit but must not surface.
        // It requires every document to carry the field — the 001 migration's
        // job — because an absent field fails the equality and the tag
        // silently vanishes.
        const docs = await collection.find({ address: { $in: cleaned }, active: true })
            .sort({ address: 1, tag: 1 })
            .toArray();
        return docs.map((doc) => this.toTag(doc));
    }

    /** @inheritdoc */
    public async getAddressesByTags(tags: string[]): Promise<IAddressTag[]> {
        const cleaned = this.normalizeTagValues(tags);
        if (cleaned.length === 0) {
            return [];
        }
        const collection = this.database.getCollection<IAddressTagDocument>(ADDRESS_TAGS_COLLECTION);
        // Liveness filter answered from the widened { tag, active, address }
        // index, since one popular tag can carry many addresses.
        const docs = await collection.find({ tag: { $in: cleaned }, active: true })
            .sort({ tag: 1, address: 1 })
            .toArray();
        return docs.map((doc) => this.toTag(doc));
    }

    /** @inheritdoc */
    public async getTagsBySource(source: string): Promise<IAddressTag[]> {
        const sourceId = String(source ?? '').trim();
        if (sourceId.length === 0) {
            throw new Error('getTagsBySource requires a non-empty source id');
        }
        const collection = this.database.getCollection<IAddressTagDocument>(ADDRESS_TAGS_COLLECTION);
        // Loaded through the multikey `sources.id` index, the same query
        // `syncSource` uses for a source's holdings. A document stays under
        // the index after the source withdraws, so the source's own element
        // decides liveness here rather than the document's `active` flag,
        // which another source or a human can hold true.
        const docs = await collection.find({ 'sources.id': sourceId })
            .sort({ address: 1, tag: 1 })
            .toArray();
        return docs
            .filter((doc) => (doc.sources ?? []).some((element) => element.id === sourceId && !element.withdrawnAt))
            .map((doc) => this.toTag(doc));
    }

    /** @inheritdoc */
    public async listTags(query?: IAddressTagListQuery): Promise<string[]> {
        const limit = this.clampLimit(query?.limit);
        // The liveness filter keeps withdrawn-only tags out of the vocabulary
        // pickers feed from — a tag no source or human still asserts should
        // not be offered for autocomplete.
        const filter: Record<string, unknown> = { active: true };
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
    public async getTagSummary(query?: IAddressTagSummaryQuery): Promise<IAddressTagSummary> {
        const limit = this.clampLimit(query?.limit);
        const collection = this.database.getCollection<IAddressTagDocument>(ADDRESS_TAGS_COLLECTION);
        // Every read here carries the liveness filter, so the summary counts
        // what the rest of the surface actually shows. Counting withdrawn
        // machine assertions would report a vocabulary an operator cannot find
        // anywhere else in the UI.
        const liveOnly = { active: true };

        // The tag grouping runs without a `$limit` stage even though the
        // caller asked for one. Truncating in the pipeline would make the
        // group count unavailable, and `totalTags` is the figure that lets the
        // UI say "showing the top 20 of 63" instead of implying it listed
        // everything. One row per distinct tag is a small result even on a
        // large collection, because the vocabulary is bounded by how many
        // labels people actually invent — unlike the address set below.
        const grouped = await collection.aggregate<{ _id: string; addresses: number }>([
            { $match: liveOnly },
            { $group: { _id: '$tag', addresses: { $sum: 1 } } },
            { $sort: { addresses: -1, _id: 1 } }
        ]).toArray();
        const tags: IAddressTagCount[] = grouped
            .slice(0, limit)
            .map((row) => ({ tag: row._id, addresses: row.addresses }));

        // Distinct addresses cannot be derived from the rows above: an address
        // carrying three tags contributes to three of them, so summing the
        // counts would report assignments and call them addresses. A second
        // grouping is the price of a correct figure. It groups the whole live
        // collection, which is why the contract documents this as a management
        // read rather than something to put on a request path.
        const addressGroups = await collection.aggregate<{ _id: string }>([
            { $match: liveOnly },
            { $group: { _id: '$address' } }
        ]).toArray();

        return {
            tags,
            totalTags: grouped.length,
            totalAddresses: addressGroups.length,
            totalAssignments: await collection.countDocuments(liveOnly)
        };
    }

    /** @inheritdoc */
    public async searchTags(query?: IAddressTagSearchQuery): Promise<IAddressTag[]> {
        const limit = this.clampLimit(query?.limit);
        const skip = Math.max(0, Math.floor(query?.skip ?? 0));
        const collection = this.database.getCollection<IAddressTagDocument>(ADDRESS_TAGS_COLLECTION);
        const docs = await collection.find(this.buildSearchFilter(query?.search) as Partial<IAddressTagDocument>)
            .sort({ address: 1, tag: 1 })
            .skip(skip)
            .limit(limit)
            .toArray();
        return docs.map((doc) => this.toTag(doc));
    }

    /** @inheritdoc */
    public async searchAddresses(query?: IAddressTagSearchQuery): Promise<IAddressTagGroup[]> {
        const limit = this.clampLimit(query?.limit);
        const skip = Math.max(0, Math.floor(query?.skip ?? 0));
        const collection = this.database.getCollection<IAddressTagDocument>(ADDRESS_TAGS_COLLECTION);
        // Two reads rather than one grouped pipeline. The pipeline pages the
        // *addresses* that match; the follow-up find loads their complete tag
        // lists. Grouping the matched documents alone would return only the
        // assignments that satisfied the search text, so an address located by
        // one of its tags would render as if that were its only tag.
        const matched = await collection.aggregate<{ _id: string }>([
            { $match: this.buildSearchFilter(query?.search) },
            { $group: { _id: '$address' } },
            { $sort: { _id: 1 } },
            { $skip: skip },
            { $limit: limit }
        ]).toArray();
        const addresses = matched.map((row) => row._id);
        if (addresses.length === 0) {
            return [];
        }
        // The tag-list load carries the liveness filter too: an address found
        // by one live tag must not render its withdrawn tags alongside it.
        const docs = await collection.find({ address: { $in: addresses }, active: true })
            .sort({ address: 1, tag: 1 })
            .toArray();
        return this.groupDocumentsByAddress(addresses, docs);
    }

    /** @inheritdoc */
    public async updateTags(renames: IAddressTagRename[], actor?: string): Promise<IAddressTag[]> {
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
        const changes: IAddressTagRenameLogEntry[] = [];
        for (const rename of cleaned) {
            if (rename.oldTag === rename.newTag) {
                changes.push({ ...rename, outcome: 'skipped-same' });
                continue;
            }
            const source = await collection.findOne({ address: rename.address, tag: rename.oldTag });
            if (!source) {
                // Missing pair — the instruction is skipped by contract.
                changes.push({ ...rename, outcome: 'skipped-missing' });
                continue;
            }
            const target = await collection.findOne({ address: rename.address, tag: rename.newTag });
            const carriesSources = (source.sources ?? []).length > 0;
            if (target || carriesSources) {
                // The human claim moves onto the destination pair, upserted
                // when it does not exist yet. The old document cannot simply
                // be renamed or deleted when it carries source elements: a
                // source asserted the *old* tag text, so renaming would
                // relabel provenance the source never asserted, and deleting
                // (the old collapse behaviour) would silently destroy it.
                // Instead the destination gains `manual`, and the old document
                // gets the clear-and-recompute treatment below.
                await collection.updateOne(
                    { address: rename.address, tag: rename.newTag },
                    {
                        $set: { manual: true, active: true, updatedAt: now },
                        $setOnInsert: { address: rename.address, tag: rename.newTag, createdAt: now, sources: [] }
                    },
                    { upsert: true }
                );
                const released = await this.releaseManualClaim(source, now);
                changes.push({
                    ...rename,
                    outcome: 'claim-moved',
                    createdAt: target?.createdAt ?? now,
                    destinationExisted: Boolean(target),
                    destinationSources: target?.sources ?? [],
                    oldDocument: released.deleted ? 'deleted' : 'kept',
                    oldDocumentActive: released.active,
                    oldDocumentSources: source.sources ?? []
                });
                continue;
            }
            // Plain rename: no collision and nothing but the human claim on
            // the document, so it moves in place, keeping its createdAt. The
            // claim flags are restated so a pre-migration document leaves this
            // write fully stamped like any other.
            await collection.updateOne(
                { address: rename.address, tag: rename.oldTag },
                { $set: { tag: rename.newTag, manual: true, active: true, updatedAt: now } }
            );
            changes.push({ ...rename, outcome: 'renamed', createdAt: source.createdAt });
        }
        this.logger.info({ actor: actor ?? UNATTRIBUTED_ACTOR, requested: cleaned.length, changes }, 'Address tags renamed');
        return this.findPairs(cleaned.map((rename) => ({ address: rename.address, tag: rename.newTag })));
    }

    /** @inheritdoc */
    public async deleteTags(tags: IAddressTagPair[], actor?: string): Promise<number> {
        const pairs = this.normalizePairs(tags);
        let deleted = 0;
        if (pairs.length > 0) {
            const collection = this.database.getCollection<IAddressTagDocument>(ADDRESS_TAGS_COLLECTION);
            const now = new Date();
            const changes: IAddressTagDeleteLogEntry[] = [];
            for (const pair of pairs) {
                const doc = await collection.findOne({ address: pair.address, tag: pair.tag });
                if (!doc) {
                    changes.push({ ...pair, outcome: 'not-found' });
                    continue;
                }
                const sources = doc.sources ?? [];
                if (sources.length === 0) {
                    // Nothing but the human claim on this document — remove it.
                    const result = await collection.deleteOne({ address: pair.address, tag: pair.tag });
                    const removed = result.deletedCount ?? 0;
                    deleted += removed;
                    // A zero count means another request removed the pair
                    // between the read and the delete, so this call changed
                    // nothing and the log says so.
                    changes.push(removed > 0
                        ? { ...pair, outcome: 'deleted', createdAt: doc.createdAt, active: false, sources }
                        : { ...pair, outcome: 'not-found' });
                    continue;
                }
                // The document also carries machine assertions, and an admin
                // removing their own tag does not revoke an external source's.
                // Clear the human claim and recompute liveness; the document
                // stays for the sources' audit trail. Counted as removed only
                // when a human claim was actually cleared — deleting a pair
                // only a machine asserts changes nothing the caller can observe.
                const active = this.computeActive(false, sources);
                await collection.updateOne(
                    { address: pair.address, tag: pair.tag },
                    { $set: { manual: false, active, updatedAt: now } }
                );
                if (doc.manual === true) {
                    deleted += 1;
                }
                changes.push({
                    ...pair,
                    outcome: doc.manual === true ? 'claim-cleared' : 'no-human-claim',
                    createdAt: doc.createdAt,
                    active,
                    sources
                });
            }
            this.logger.info({ actor: actor ?? UNATTRIBUTED_ACTOR, requested: pairs.length, deleted, changes }, 'Address tags deleted');
        }
        return deleted;
    }

    /** @inheritdoc */
    public async syncSource(
        source: string,
        assertions: IAddressTagAssertion[],
        mode: 'snapshot' | 'delta',
        withdrawn?: IAddressTagAssertion[]
    ): Promise<IAddressTagSyncResult> {
        const sourceId = String(source ?? '').trim();
        if (sourceId.length === 0) {
            throw new Error('syncSource requires a non-empty source id');
        }
        const result: IAddressTagSyncResult = { source: sourceId, added: 0, refreshed: 0, withdrawn: 0, rejected: 0 };
        const collection = this.database.getCollection<IAddressTagDocument>(ADDRESS_TAGS_COLLECTION);
        const now = new Date();

        // Validate the whole batch up front, skipping (not failing on) bad
        // entries: one malformed feed row must not block the rest of a
        // sanctions update. Validation happens before the snapshot floor so
        // the floor compares counts of assertions that could actually apply.
        const valid = this.validateAssertions(assertions, sourceId, result);

        // This source's current live holdings, loaded through the multikey
        // `sources.id` index. Both the snapshot diff and the delta withdrawal
        // path need the stored documents to recompute `active` afterwards.
        const holdings = await collection.find({ 'sources.id': sourceId }).toArray();
        const heldByKey = new Map<string, IAddressTagDocument>();
        const liveKeys = new Set<string>();
        for (const doc of holdings) {
            const key = this.pairKey(doc.address, doc.tag);
            heldByKey.set(key, doc);
            const element = (doc.sources ?? []).find((item) => item.id === sourceId);
            if (element && !element.withdrawnAt) {
                liveKeys.add(key);
            }
        }

        // Snapshot floor: an empty or truncated download must never be read
        // as "everything was delisted". Half the current holdings is crude,
        // but mass-withdrawal of sanctions data is the worst failure mode
        // available, so refusing loudly beats reconciling quietly.
        if (mode === 'snapshot' && liveKeys.size > 0 && valid.length < liveKeys.size / 2) {
            throw new Error(
                `Refusing snapshot reconcile for source '${sourceId}': fetched ${valid.length} assertions `
                + `against ${liveKeys.size} currently held — a truncated feed must not mass-withdraw`
            );
        }

        const assertedKeys = new Set<string>();
        for (const assertion of valid) {
            assertedKeys.add(this.pairKey(assertion.address, assertion.tag));
            const refreshed = await this.applyAssertion(assertion, sourceId, now);
            if (refreshed) {
                result.refreshed += 1;
            } else {
                result.added += 1;
            }
        }

        // Withdrawal set: in snapshot mode it is the diff against what the
        // source just asserted; in delta mode it is exactly the revocations
        // the caller passed, restricted to pairs this source actually holds
        // live (revoking something never held, or already withdrawn, is a
        // no-op rather than an error, which is what makes replays after a
        // cursor overlap safe).
        let keysToWithdraw: string[];
        if (mode === 'snapshot') {
            keysToWithdraw = [...liveKeys].filter((key) => !assertedKeys.has(key));
        } else {
            const revocations = this.validateAssertions(withdrawn ?? [], sourceId, result);
            keysToWithdraw = revocations
                .map((item) => this.pairKey(item.address, item.tag))
                .filter((key) => liveKeys.has(key));
        }
        for (const key of keysToWithdraw) {
            const doc = heldByKey.get(key);
            if (!doc) {
                continue;
            }
            await this.withdrawSourceElement(doc, sourceId, now);
            result.withdrawn += 1;
        }

        this.logger.info(result, 'Source reconcile applied');
        return result;
    }

    /**
     * Validate one batch of source assertions, counting failures into the
     * running result instead of throwing. Machine feeds are external input:
     * a single malformed address in an 80MB export must cost one logged
     * rejection, not the whole reconcile.
     *
     * @param assertions - Raw assertions from a source's fetcher.
     * @param sourceId - The source being reconciled, for the rejection log line.
     * @param result - Running counts; `rejected` is incremented in place.
     * @returns The assertions that passed validation, normalized.
     */
    private validateAssertions(
        assertions: IAddressTagAssertion[],
        sourceId: string,
        result: IAddressTagSyncResult
    ): IAddressTagAssertion[] {
        const valid: IAddressTagAssertion[] = [];
        for (const assertion of assertions) {
            try {
                valid.push({
                    address: this.requireAddress(assertion.address),
                    // The ingestion path is the one writer allowed to use the
                    // reserved prefixes — that is what they are reserved for.
                    tag: this.requireTag(assertion.tag, { allowReserved: true }),
                    ref: assertion.ref,
                    url: assertion.url
                });
            } catch (error) {
                result.rejected += 1;
                this.logger.warn(
                    { source: sourceId, assertion, error: error instanceof Error ? error.message : String(error) },
                    'Rejected source assertion'
                );
            }
        }
        return valid;
    }

    /**
     * Apply one validated assertion for one source, in the two-step shape
     * MongoDB requires because it has no single "upsert an array element"
     * operator.
     *
     * Step 1 refreshes this source's element when it is already on the
     * document. The `sources.id` test lives in the *filter*, not only in
     * `arrayFilters`, so `matchedCount` answers exactly one question: was this
     * source already on the document? Branching on `modifiedCount` instead
     * would misreport, because the top-level `updatedAt`/`active` writes apply
     * to any matched document, making `modifiedCount` 1 whether or not the
     * element existed — step 2 would then never run and a second source's
     * element would never be pushed. Clearing `withdrawnAt` in step 1 is what
     * makes a re-listing work: an address the source removes and later
     * restores comes back live instead of staying invisible.
     *
     * Step 2 runs when the source is new to the document (or the document is
     * new) and pushes the element, creating the document as machine-only
     * (`manual: false`) when it did not exist.
     *
     * @param assertion - The validated assertion to apply.
     * @param sourceId - The source whose element is written.
     * @param now - The reconcile pass's single timestamp.
     * @returns True when step 1 refreshed an existing element, false when
     *          step 2 added one, so the caller can count added vs refreshed.
     */
    private async applyAssertion(assertion: IAddressTagAssertion, sourceId: string, now: Date): Promise<boolean> {
        const collection = this.database.getCollection<IAddressTagDocument>(ADDRESS_TAGS_COLLECTION);
        const refresh: Record<string, unknown> = {
            'sources.$[elem].observedAt': now,
            updatedAt: now,
            active: true
        };
        if (assertion.ref !== undefined) {
            refresh['sources.$[elem].ref'] = assertion.ref;
        }
        if (assertion.url !== undefined) {
            refresh['sources.$[elem].url'] = assertion.url;
        }
        const touched = await collection.updateOne(
            { address: assertion.address, tag: assertion.tag, 'sources.id': sourceId },
            {
                $set: refresh,
                $unset: { 'sources.$[elem].withdrawnAt': '' }
            },
            { arrayFilters: [{ 'elem.id': sourceId }] }
        );
        if (touched.matchedCount > 0) {
            return true;
        }
        const element: IAddressTagSource = { id: sourceId, observedAt: now };
        if (assertion.ref !== undefined) {
            element.ref = assertion.ref;
        }
        if (assertion.url !== undefined) {
            element.url = assertion.url;
        }
        await collection.updateOne(
            { address: assertion.address, tag: assertion.tag },
            {
                $push: { sources: element },
                $setOnInsert: { manual: false, createdAt: now },
                $set: { updatedAt: now, active: true }
            },
            { upsert: true }
        );
        return false;
    }

    /**
     * Soft-withdraw one source's element on one document: stamp
     * `withdrawnAt` on that element alone and recompute the document's
     * liveness in the same write. The document is never deleted — the
     * element stays as the audit record of what the source asserted and
     * when it stopped.
     *
     * `active` after the withdrawal is derived from the human claim plus the
     * *other* sources' elements, computed here from the document already in
     * hand so the stamp and the recompute land in one update instead of a
     * read-modify-write pair per document.
     *
     * @param doc - The stored document as loaded at the start of the pass.
     * @param sourceId - The source whose element is being withdrawn.
     * @param now - The reconcile pass's single timestamp.
     */
    private async withdrawSourceElement(doc: IAddressTagDocument, sourceId: string, now: Date): Promise<void> {
        const collection = this.database.getCollection<IAddressTagDocument>(ADDRESS_TAGS_COLLECTION);
        const others = (doc.sources ?? []).filter((element) => element.id !== sourceId);
        const stillActive = this.computeActive(doc.manual === true, others);
        await collection.updateOne(
            { address: doc.address, tag: doc.tag, 'sources.id': sourceId },
            {
                $set: {
                    'sources.$[elem].withdrawnAt': now,
                    active: stillActive,
                    updatedAt: now
                }
            },
            { arrayFilters: [{ 'elem.id': sourceId }] }
        );
    }

    /**
     * Remove the human claim from a document during a rename, keeping or
     * deleting the document by whether machine sources still cite it. This is
     * the "clear and recompute" half of the rename correction: the human's
     * claim moved to the destination tag, but any source elements assert the
     * *old* tag text and must survive under it.
     *
     * @param doc - The old-tag document as loaded by the rename loop.
     * @param now - The mutation batch's single timestamp.
     * @returns Whether the old document was deleted and its liveness
     *          afterwards, so the rename log line can record what became of
     *          the old tag text.
     */
    private async releaseManualClaim(doc: IAddressTagDocument, now: Date): Promise<{ deleted: boolean; active: boolean }> {
        const collection = this.database.getCollection<IAddressTagDocument>(ADDRESS_TAGS_COLLECTION);
        const sources = doc.sources ?? [];
        const deleted = sources.length === 0;
        const active = this.computeActive(false, sources);
        if (deleted) {
            await collection.deleteOne({ address: doc.address, tag: doc.tag });
        } else {
            await collection.updateOne(
                { address: doc.address, tag: doc.tag },
                { $set: { manual: false, active, updatedAt: now } }
            );
        }
        return { deleted, active };
    }

    /**
     * Build the log entry for one pair in a create batch from the document
     * that existed before the upsert. Kept out of the `createTags` loop so the
     * three outcomes are decided in one readable place.
     *
     * A document with no `manual` field predates the provenance migration and
     * was typed by an admin, so it counts as already claimed, matching how
     * `toTag` reads it.
     *
     * @param pair - The normalized pair the create wrote.
     * @param existing - The stored document before the upsert, or undefined
     *                   when the pair was new.
     * @param now - The batch timestamp, which becomes `createdAt` for a new pair.
     * @returns The entry describing what the create did to this pair.
     */
    private describeCreate(
        pair: IAddressTagPair,
        existing: IAddressTagDocument | undefined,
        now: Date
    ): IAddressTagCreateLogEntry {
        let outcome: IAddressTagCreateLogEntry['outcome'] = 'created';
        let previous: IAddressTagCreateLogEntry['previous'] = null;
        if (existing) {
            outcome = existing.manual === false ? 'claimed' : 'unchanged';
            previous = { manual: existing.manual ?? true, active: existing.active ?? true };
        }
        return {
            address: pair.address,
            tag: pair.tag,
            outcome,
            previous,
            manual: true,
            active: true,
            createdAt: existing?.createdAt ?? now,
            sources: existing?.sources ?? []
        };
    }

    /**
     * The liveness derivation rule, kept in one place rather than in each
     * write path: a document is active while a human asserts it or any source
     * element has not been withdrawn.
     *
     * @param manual - Whether a human currently asserts the tag.
     * @param sources - The source elements to test for a live assertion.
     * @returns Whether the document should be visible on read surfaces.
     */
    private computeActive(manual: boolean, sources: IAddressTagSource[]): boolean {
        return manual || sources.some((element) => !element.withdrawnAt);
    }

    /**
     * Stable key for a `(address, tag)` pair in the reconcile's in-memory
     * sets. The address is fixed-width base58 with no spaces, so the space
     * separator cannot be ambiguous even though tags may contain spaces.
     *
     * @param address - Validated TRON address.
     * @param tag - Validated tag text.
     * @returns The combined lookup key.
     */
    private pairKey(address: string, tag: string): string {
        return `${address} ${tag}`;
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
        // Reads accept reserved-prefix values: the guard exists to stop a
        // human *writing* a machine source's tag, not to stop anyone looking
        // up which addresses carry `ofac:sdn`.
        return [...new Set(tags.map((tag) => this.requireTag(tag, { allowReserved: true })))];
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
     * Enforce tag shape: non-empty trimmed text within the length ceiling,
     * comma-free, and — unless the caller is the ingestion path — free of the
     * reserved machine-source prefixes. This method stays the single
     * validation authority every path flows through; the ingestion exemption
     * is an internal flag rather than a second validator precisely so there
     * remains exactly one place where tag text is checked.
     *
     * The comma rule exists because the read surface (`parseList` in the user
     * controller) treats commas as the array delimiter in `?tags=x,y`, so a
     * stored comma-bearing tag would be unretrievable by `/by-tag`. The
     * reserved-prefix rule exists because a human typing `ofac:sdn` would
     * manufacture a sanctions claim with no provenance behind it.
     *
     * @param tag - Raw caller input.
     * @param options - `allowReserved` is set by `syncSource`'s validation and
     *                  by tag-value *reads*, the two paths for which reserved
     *                  prefixes are legitimate input.
     * @returns The trimmed, validated tag.
     */
    private requireTag(tag: string, options?: { allowReserved?: boolean }): string {
        const trimmed = String(tag ?? '').trim();
        if (trimmed.length === 0 || trimmed.length > MAX_TAG_LENGTH) {
            throw new Error(`Invalid tag: must be 1-${MAX_TAG_LENGTH} characters`);
        }
        if (trimmed.includes(',')) {
            throw new Error('Invalid tag: commas are not allowed');
        }
        if (!options?.allowReserved) {
            const lowered = trimmed.toLowerCase();
            const reserved = RESERVED_TAG_PREFIXES.find((prefix) => lowered.startsWith(prefix));
            if (reserved) {
                throw new Error(`Invalid tag: the '${reserved}' prefix is reserved for machine sources`);
            }
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
        const docs = await this.findPairDocuments(pairs);
        return docs.map((doc) => this.toTag(doc));
    }

    /**
     * Load the raw stored documents for a set of pairs in one query. Shared by
     * `findPairs`, which projects them for callers, and `createTags`, which
     * needs the provenance fields before its upserts to describe what changed.
     *
     * @param pairs - Already-normalized pairs to load.
     * @returns The stored documents matching the pairs, sorted by address
     *          then tag; empty when no pairs were given.
     */
    private async findPairDocuments(pairs: IAddressTagPair[]): Promise<IAddressTagDocument[]> {
        let docs: IAddressTagDocument[] = [];
        if (pairs.length > 0) {
            const collection = this.database.getCollection<IAddressTagDocument>(ADDRESS_TAGS_COLLECTION);
            docs = await collection.find({ $or: pairs.map((pair) => ({ address: pair.address, tag: pair.tag })) })
                .sort({ address: 1, tag: 1 })
                .toArray();
        }
        return docs;
    }

    /**
     * Build the Mongo filter for a management search. Shared by the assignment
     * and address-group searches so both agree on what "matches" means — an
     * address matches when its own text or any of its tags contains the term.
     * The liveness filter rides along: these searches match with a regex no
     * index can serve anyway, so `active` narrows the result set here without
     * changing the scan.
     *
     * @param search - Raw caller-supplied search text, possibly absent or blank.
     * @returns A filter matching every live assignment when no usable search
     *          text was given.
     */
    private buildSearchFilter(search?: string): Record<string, unknown> {
        const trimmed = search?.trim();
        if (!trimmed) {
            return { active: true };
        }
        const pattern = { $regex: escapeRegex(trimmed), $options: 'i' };
        return { active: true, $or: [{ address: pattern }, { tag: pattern }] };
    }

    /**
     * Fold a flat, address-sorted document list into one group per address.
     *
     * Iterates the caller's `addresses` array rather than the documents so the
     * result preserves the paged address order the aggregation established,
     * which is what keeps successive "load more" pages contiguous.
     *
     * @param addresses - The page of addresses, already in display order.
     * @param docs - Every stored assignment for those addresses.
     * @returns One group per address, each carrying its full tag list and the
     *          latest `updatedAt` among those tags.
     */
    private groupDocumentsByAddress(addresses: string[], docs: IAddressTagDocument[]): IAddressTagGroup[] {
        const byAddress = new Map<string, IAddressTag[]>(addresses.map((address) => [address, []]));
        for (const doc of docs) {
            byAddress.get(doc.address)?.push(this.toTag(doc));
        }
        const groups: IAddressTagGroup[] = [];
        for (const address of addresses) {
            const tags = byAddress.get(address) ?? [];
            const updatedAt = tags.reduce<Date>(
                (latest, tag) => (tag.updatedAt > latest ? tag.updatedAt : latest),
                tags[0]?.updatedAt ?? new Date(0)
            );
            groups.push({ address, tags, updatedAt });
        }
        return groups;
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
     * storage-only fields (`_id`). Documents written before the
     * `001_add_provenance_fields` migration lack the provenance fields, so
     * absent values default to the migration's own interpretation — a legacy
     * document was typed by an admin, making it a live manual tag with no
     * sources. This is presentation defaulting only; the stored documents are
     * repaired by the migration, not by reads.
     *
     * @param doc - Stored assignment document.
     * @returns The public tag record.
     */
    private toTag(doc: IAddressTagDocument): IAddressTag {
        return {
            address: doc.address,
            tag: doc.tag,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt,
            manual: doc.manual ?? true,
            active: doc.active ?? true,
            sources: doc.sources ?? []
        };
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
