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
