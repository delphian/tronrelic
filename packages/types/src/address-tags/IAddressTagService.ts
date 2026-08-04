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
     * tag would be stored but never retrievable. Writes that violate either
     * rule throw rather than silently normalizing.
     */
    tag: string;
}

/**
 * A stored tag assignment as returned by every read and mutation method,
 * extending the pair with bookkeeping timestamps.
 */
export interface IAddressTag extends IAddressTagPair {
    /** When this assignment was first created. */
    createdAt: Date;
    /** When this assignment was last modified (rename). */
    updatedAt: Date;
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
     * Delete tag assignments.
     *
     * @param tags - The exact `(address, tag)` pairs to remove; missing pairs are ignored.
     * @returns The number of assignments actually removed.
     */
    deleteTags(tags: IAddressTagPair[]): Promise<number>;
}
