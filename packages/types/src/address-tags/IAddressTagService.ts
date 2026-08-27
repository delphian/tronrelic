/**
 * @fileoverview Published contract for the address-tags module.
 *
 * Address tags attach short free-text labels to TRON wallet addresses so any
 * surface (UI, AI tools, sinks) can annotate and look up addresses through one
 * shared vocabulary. The service is the single authority over tag storage —
 * every API, tool, or sink is a thin wrapper around these methods, which is why
 * the contract lives in the types package rather than in core: consumers couple
 * to this interface via the service registry (`'address-tags'`), never to the
 * implementation.
 */

/**
 * The identity of one tag assignment — a `(address, tag)` pair. Used both as
 * the stored record's key and as the input shape for create/delete calls.
 */
export interface IAddressTagPair {
    /** TRON wallet address (base58) the tag is attached to. */
    address: string;
    /**
     * Free-text tag attached to the address: 1–64 characters after trimming,
     * and may not contain a comma. The comma is reserved as the delimiter in
     * the HTTP read surface's `?tags=x,y` array encoding, so a comma-bearing
     * tag would be stored but never retrievable. Tag text starting with a
     * reserved machine-source prefix (`ofac:`, `usdt:`, `chainalysis:`) is
     * rejected on the human write paths so an operator cannot impersonate an
     * ingestion source; only `syncSource` may write those. Writes that violate
     * any rule throw rather than silently normalizing.
     */
    tag: string;
}

/**
 * One machine source's element inside a tag assignment's provenance array.
 * Each element records that a named external source (a sanctions list, a
 * freeze feed, a screening API) asserted this `(address, tag)` pair, when it
 * last confirmed it, and — via `withdrawnAt` — whether it has since stopped
 * asserting it. Withdrawal is soft: the element stays for audit rather than
 * being removed, because a bare tag with no citation is exactly the state the
 * provenance work exists to prevent.
 */
export interface IAddressTagSource {
    /** Source identifier, e.g. 'ofac-sdn', 'usdt-blacklist', 'chainalysis'. */
    id: string;
    /**
     * Source-native reference making the assertion citable — an OFAC entity
     * uid, or the transaction hash that froze the address.
     */
    ref?: string;
    /** Citable link a UI can surface next to the tag. */
    url?: string;
    /** Last time this source confirmed the assertion. */
    observedAt: Date;
    /**
     * Set when this source stopped asserting the pair. An element with this
     * field no longer contributes to the document's liveness.
     */
    withdrawnAt?: Date;
}

/**
 * A stored tag assignment as returned by every read and mutation method,
 * extending the pair with bookkeeping timestamps and provenance. A human and
 * a machine source can independently assert the same pair, so the human claim
 * is an explicit `manual` flag rather than "sources absent" — deleting the
 * document when a source withdraws would otherwise take the operator's tag
 * with it.
 */
export interface IAddressTag extends IAddressTagPair {
    /** When this assignment was first created. */
    createdAt: Date;
    /** When this assignment was last modified (rename). */
    updatedAt: Date;
    /** True when a human asserted this tag (independent of any sources). */
    manual: boolean;
    /**
     * Denormalized liveness, recomputed on every write: true when `manual` is
     * true or any element of `sources` has no `withdrawnAt`. Kept as a stored
     * boolean so read paths filter with a plain indexed equality instead of
     * each repeating an `$elemMatch` over the sources array.
     */
    active: boolean;
    /** Every machine source that has asserted this pair, withdrawn or live. */
    sources: IAddressTagSource[];
}

/**
 * One rename instruction: replace `oldTag` with `newTag` on `address`. This is
 * the "old → new kv pair" exception to the array-of-pairs shape — an update
 * needs both sides of the change to be expressible.
 */
export interface IAddressTagRename {
    /** TRON wallet address whose tag is being renamed. */
    address: string;
    /** Existing tag value to replace. */
    oldTag: string;
    /** Replacement tag value. */
    newTag: string;
}

/**
 * Options for enumerating the distinct tag vocabulary, e.g. to feed a picker
 * or autocomplete surface.
 */
export interface IAddressTagListQuery {
    /** Case-sensitive prefix filter on the tag text. */
    prefix?: string;
    /** Maximum number of distinct tags to return. */
    limit?: number;
}

/**
 * Paged search over stored assignments for management surfaces (the
 * `/system/address-tags` table). Distinct from `listTags`, which enumerates
 * only the distinct tag vocabulary.
 */
export interface IAddressTagSearchQuery {
    /** Case-insensitive substring matched against both address and tag. */
    search?: string;
    /** Maximum number of assignments to return. */
    limit?: number;
    /** Number of assignments to skip (pagination offset). */
    skip?: number;
}

/**
 * Every tag attached to one address, returned by the address-oriented search
 * management surfaces use. Grouping happens in the service rather than in each
 * caller because paging must advance by *address* — a caller that grouped a
 * page of flat assignments itself would split an address whose tags straddle
 * the page boundary, showing the same address twice with partial tag lists.
 */
export interface IAddressTagGroup {
    /** TRON wallet address the tags belong to. */
    address: string;
    /** Every stored assignment on this address, ordered by tag. */
    tags: IAddressTag[];
    /** Most recent `updatedAt` across the address's tags. */
    updatedAt: Date;
}

/**
 * One assertion a source is making about an address at fetch time. This is
 * the ingestion-side input shape: the source's fetcher turns its raw feed
 * into these, and `syncSource` reconciles them against stored provenance.
 */
export interface IAddressTagAssertion {
    /** TRON wallet address (base58) the source is asserting about. */
    address: string;
    /** Exact tag text the source asserts, e.g. 'ofac:sdn'. */
    tag: string;
    /** Source-native citation reference (entity uid, freezing tx hash). */
    ref?: string;
    /** Citable link backing the assertion. */
    url?: string;
}

/**
 * What one reconcile pass actually changed, for logging and the admin source
 * status surface. Without these counts a silently failing feed is
 * indistinguishable from a clean one.
 */
export interface IAddressTagSyncResult {
    /** The source id the pass ran for. */
    source: string;
    /** Assertions that created a document or joined an existing one. */
    added: number;
    /** Assertions already present whose element was re-confirmed. */
    refreshed: number;
    /** Stored assertions this pass stamped as withdrawn. */
    withdrawn: number;
    /** Assertions that failed validation; logged with the offending value. */
    rejected: number;
}

/**
 * Central CRUD authority for text tags on TRON wallet addresses. All methods
 * accept and return arrays so callers batch naturally; single-item calls are
 * just one-element arrays. Authorization is the caller's responsibility — the
 * service trusts its inputs, and the HTTP layer gates reads to registered
 * users and mutations to admins.
 *
 * Every write validates its addresses and tags and throws on the first bad
 * entry, so a batch is all-or-nothing at the validation boundary. See
 * {@link IAddressTagPair.tag} for the tag constraints a caller must satisfy.
 */
export interface IAddressTagService {
    /**
     * Create tag assignments. Existing `(address, tag)` pairs are skipped
     * rather than erroring so batch creates are idempotent.
     *
     * @param tags - The pairs to create; each is validated and normalized.
     * @returns The stored records for every pair now present (created or pre-existing).
     */
    createTags(tags: IAddressTagPair[]): Promise<IAddressTag[]>;

    /**
     * Look up all tags attached to any of the given addresses.
     *
     * @param addresses - Addresses to resolve; unknown addresses simply contribute nothing.
     * @returns Every stored assignment whose address is in the input.
     */
    getTagsByAddresses(addresses: string[]): Promise<IAddressTag[]>;

    /**
     * Reverse lookup: all assignments carrying any of the given tags.
     *
     * @param tags - Tag values to resolve; unknown tags simply contribute nothing.
     * @returns Every stored assignment whose tag is in the input.
     */
    getAddressesByTags(tags: string[]): Promise<IAddressTag[]>;

    /**
     * Enumerate the distinct tag vocabulary, optionally prefix-filtered, for
     * pickers and autocomplete.
     *
     * @param query - Optional prefix and limit constraints.
     * @returns Distinct tag values in ascending order.
     */
    listTags(query?: IAddressTagListQuery): Promise<string[]>;

    /**
     * Paged search over all stored assignments for management surfaces.
     *
     * @param query - Optional substring filter and pagination window.
     * @returns Matching assignments ordered by address then tag.
     */
    searchTags(query?: IAddressTagSearchQuery): Promise<IAddressTag[]>;

    /**
     * Paged search that returns one entry per *address* with every tag on that
     * address attached, for management tables that present an address as a
     * single row. An address qualifies when any of its assignments matches the
     * search text, but the returned group always carries the address's full tag
     * list — so searching a tag shows what else that address is labelled with.
     *
     * `limit` and `skip` count addresses, not assignments, so a page never
     * splits an address's tags.
     *
     * @param query - Optional substring filter and address-wise pagination window.
     * @returns Matching addresses in ascending order, each with its full tag list.
     */
    searchAddresses(query?: IAddressTagSearchQuery): Promise<IAddressTagGroup[]>;

    /**
     * Rename tags in place. Each instruction replaces `oldTag` with `newTag`
     * on one address; a missing `(address, oldTag)` pair is skipped, and a
     * rename that collides with an existing `(address, newTag)` pair collapses
     * into it (the old record is removed).
     *
     * @param renames - The rename instructions to apply.
     * @returns The stored records now present under each instruction's new tag.
     */
    updateTags(renames: IAddressTagRename[]): Promise<IAddressTag[]>;

    /**
     * Delete tag assignments. A document that also carries machine sources is
     * not removed — the human claim (`manual`) is cleared and `active`
     * recomputed instead, because an admin removing their own tag does not
     * revoke an external source's assertion.
     *
     * @param tags - The exact `(address, tag)` pairs to remove; missing pairs are ignored.
     * @returns The number of assignments the call took effect on (documents
     *          deleted plus documents whose `manual` flag was cleared).
     */
    deleteTags(tags: IAddressTagPair[]): Promise<number>;

    /**
     * Reconcile one machine source's assertions against stored provenance.
     * This is the only write path that touches `sources` elements, and it only
     * ever touches elements whose `id` matches the source it was called for —
     * it cannot see or remove a human tag, and the human-facing mutations
     * cannot touch a source's elements.
     *
     * In `'snapshot'` mode the assertions are the source's complete current
     * state: anything the source holds that is missing from the batch is
     * soft-withdrawn (its element gains `withdrawnAt`; the document stays for
     * audit). A snapshot far smaller than the source's current holdings is
     * refused rather than applied, so a truncated or empty feed download can
     * never be read as "everything was delisted". In `'delta'` mode only the
     * given changes are applied: `assertions` are added or re-confirmed,
     * `withdrawn` entries are soft-withdrawn, and unmentioned tags are left
     * alone.
     *
     * Invalid assertions are counted as `rejected` and skipped rather than
     * failing the batch, since one malformed feed row must not block the rest
     * of a sanctions update.
     *
     * @param source - The source id whose elements this pass may touch.
     * @param assertions - What the source currently asserts (snapshot) or the
     *                     additions/re-confirmations to apply (delta).
     * @param mode - `'snapshot'` diffs and withdraws the missing; `'delta'`
     *               applies only what it was given.
     * @param withdrawn - Delta mode only: assertions the source explicitly
     *                    revoked (e.g. blacklist-removal events). Ignored in
     *                    snapshot mode, where withdrawal is the set difference.
     * @returns Counts of what the pass changed, for logging and status surfaces.
     */
    syncSource(
        source: string,
        assertions: IAddressTagAssertion[],
        mode: 'snapshot' | 'delta',
        withdrawn?: IAddressTagAssertion[]
    ): Promise<IAddressTagSyncResult>;
}
