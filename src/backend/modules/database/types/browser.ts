/**
 * TypeScript interfaces for the database browser feature.
 *
 * These interfaces define the data structures used for browsing MongoDB collections
 * and documents through the admin interface.
 */

/**
 * Statistics for a single collection in the database.
 *
 * Provides essential metrics for collection sizing, document counts, and index information
 * to help administrators understand database composition at a glance.
 */
export interface ICollectionStat {
    /**
     * Name of the collection as it appears in MongoDB.
     */
    name: string;

    /**
     * Total number of documents in the collection.
     */
    count: number;

    /**
     * Total size of the collection in bytes (including indexes).
     */
    size: number;

    /**
     * Average document size in bytes.
     * Calculated as size / count. May be 0 if count is 0.
     */
    avgObjSize: number;

    /**
     * Number of indexes defined on the collection.
     */
    indexes: number;
}

/**
 * Paginated response for document listing.
 *
 * Follows standard pagination patterns used throughout TronRelic for consistent UX.
 * Uses cursor-based pagination internally for large collections, but exposes simple
 * page/limit interface to frontend consumers.
 */
export interface IPaginatedDocuments {
    /**
     * Array of documents from the collection.
     * Documents are returned as-is from MongoDB without transformation.
     */
    documents: any[];

    /**
     * Total number of documents matching the query (not just current page).
     */
    total: number;

    /**
     * Current page number (1-indexed).
     */
    page: number;

    /**
     * Number of documents per page.
     */
    limit: number;

    /**
     * Total number of pages available.
     */
    totalPages: number;

    /**
     * Whether there is a next page available.
     */
    hasNextPage: boolean;

    /**
     * Whether there is a previous page available.
     */
    hasPrevPage: boolean;
}

/**
 * Options for querying documents with pagination and sorting.
 *
 * Provides flexible query configuration while maintaining security through
 * sanitization and size limits.
 */
export interface IQueryOptions {
    /**
     * MongoDB filter object.
     * Sanitized by express-mongo-sanitize to prevent injection attacks.
     *
     * @example
     * { status: 'active' }
     * { timestamp: { $gte: new Date('2024-01-01') } }
     */
    filter?: Record<string, any>;

    /**
     * Page number (1-indexed).
     */
    page: number;

    /**
     * Number of documents per page.
     * Limited to maximum of 100 for performance.
     */
    limit: number;

    /**
     * Sort specification as MongoDB sort object.
     *
     * @example
     * { _id: -1 } // Newest first
     * { timestamp: 1, _id: 1 } // Oldest first with _id tiebreaker
     */
    sort: Record<string, 1 | -1>;
}

/**
 * Which end of a collection, or which way from a cursor, a page is read.
 *
 * `first` and `last` are absolute anchors and carry no cursor; `next` and
 * `prev` step relative to one.
 */
export type CursorDirection = 'first' | 'next' | 'prev' | 'last';

/**
 * Options for reading one page by cursor rather than by offset.
 *
 * Deliberately has no `page` field. A page number is exactly the input that
 * forces a `skip`, and `skip` is what makes the far end of a large collection
 * unreachable — see `getDocumentPage` for the full reasoning.
 */
export interface ICursorQueryOptions {
    /**
     * Number of documents per page. Capped at 100, as with offset paging.
     */
    limit: number;

    /**
     * Which end to read, or which way to step from `cursor`.
     */
    direction: CursorDirection;

    /**
     * The edge to step from, as the opaque token the client received.
     *
     * Required for `next` and `prev`, ignored for `first` and `last`. For
     * `next` it is the token for the last `_id` on the current page; for
     * `prev`, the first. The document it names need not still exist — a keyset
     * boundary is a value comparison, not a reference — so a page survives the
     * deletion of the document that anchored it.
     *
     * Server-minted and server-read only: the token carries the `_id`'s BSON
     * type as well as its value, because MongoDB brackets range comparisons by
     * type and a bound of the wrong type matches nothing instead of failing.
     * Clients pass it back verbatim and never construct one.
     */
    cursor?: string;
}

/**
 * One page of documents located by keyset rather than by offset.
 *
 * Distinct from `IPaginatedDocuments` because the two carry genuinely
 * different knowledge. Offset paging knows which page it is on; keyset paging
 * knows only where its own edges are and whether documents lie beyond them.
 * The page *number* shown in the UI is therefore the client's running count,
 * not a server fact, and this shape declines to invent one.
 */
export interface ICursorDocuments {
    /**
     * Documents for this page, in display order (descending `_id`).
     */
    documents: any[];

    /**
     * Estimated collection size, read from collection metadata rather than by
     * counting.
     *
     * Approximate on a collection taking concurrent writes. Good enough for an
     * "of N documents" readout and a page-count estimate; not a basis for
     * arithmetic that has to be exact.
     */
    total: number;

    /**
     * Documents per page, echoed so the client can derive its page count.
     */
    limit: number;

    /**
     * Estimated total pages, derived from `total` — inherits its approximation.
     */
    totalPages: number;

    /**
     * Opaque token for the first document on this page.
     *
     * Pass back as `cursor` with direction `prev`. Null on an empty page.
     */
    startCursor: string | null;

    /**
     * Opaque token for the last document on this page.
     *
     * Pass back as `cursor` with direction `next`. Null on an empty page.
     */
    endCursor: string | null;

    /**
     * Whether any document lies past the end of this page.
     */
    hasNextPage: boolean;

    /**
     * Whether any document lies before the start of this page.
     */
    hasPrevPage: boolean;
}

/**
 * Summary statistics for the entire database.
 *
 * Provides administrators with a top-level view of database size and composition
 * before drilling into individual collections.
 */
export interface IDatabaseStats {
    /**
     * Name of the database.
     */
    dbName: string;

    /**
     * Total size of all collections in bytes.
     */
    totalSize: number;

    /**
     * Statistics for each collection in the database.
     */
    collections: ICollectionStat[];
}
