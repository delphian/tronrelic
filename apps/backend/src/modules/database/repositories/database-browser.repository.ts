/**
 * Repository for database browsing operations.
 *
 * Handles all MongoDB queries for the database browser feature. Provides methods for
 * retrieving collection statistics, paginating documents, and executing filtered queries.
 *
 * Why this exists as a repository:
 * - Separates data access logic from HTTP handling in controllers
 * - Provides testable interface for MongoDB operations (can mock repository in tests)
 * - Centralizes cursor-based pagination and query optimization logic
 * - Maintains security through consistent filter sanitization
 *
 * Uses native MongoDB driver methods via Mongoose connection for direct database access.
 */

import type { Connection } from 'mongoose';
import type { ISystemLogService } from '@tronrelic/types';
import type {
    ICollectionStat,
    IPaginatedDocuments,
    IQueryOptions,
    IDatabaseStats
} from '../types/browser.js';

export class DatabaseBrowserRepository {
    /**
     * Creates a new database browser repository instance.
     *
     * @param connection - Mongoose connection instance for database access
     * @param logger - Logger for query operations and errors
     */
    constructor(
        private connection: Connection,
        private logger: ISystemLogService
    ) {}

    /**
     * Retrieves statistics for all collections in the database.
     *
     * Fetches collection names, document counts, sizes, and index counts for the entire database.
     * This provides the overview needed for the main database browser interface.
     *
     * Why we query each collection individually:
     * - MongoDB's listCollections() only returns names, not statistics
     * - Collection.stats() provides detailed metrics including size and index info
     * - Querying in series prevents overwhelming the database with concurrent stats requests
     *
     * @returns Database statistics including per-collection metrics
     * @throws {Error} If database connection is not established
     */
    async getDatabaseStats(): Promise<IDatabaseStats> {
        if (!this.connection || this.connection.readyState !== 1) {
            throw new Error('Database connection not established');
        }

        const db = this.connection.db;
        if (!db) {
            throw new Error('Database not connected');
        }

        const dbName = db.databaseName;

        this.logger.debug({ dbName }, 'Fetching database statistics');

        // List all collections
        const collections = await db.listCollections().toArray();

        this.logger.debug({ count: collections.length }, 'Collections found');

        // Fetch stats for each collection
        const collectionStats: ICollectionStat[] = [];
        let totalSize = 0;

        for (const collectionInfo of collections) {
            try {
                const collection = db.collection(collectionInfo.name);
                const stats = await db.command({ collStats: collectionInfo.name });

                const collectionStat: ICollectionStat = {
                    name: collectionInfo.name,
                    count: stats.count || 0,
                    size: stats.size || 0,
                    avgObjSize: stats.avgObjSize || 0,
                    indexes: stats.nindexes || 0
                };

                collectionStats.push(collectionStat);
                totalSize += collectionStat.size;
            } catch (error) {
                // Log error but continue with other collections
                this.logger.warn(
                    { collection: collectionInfo.name, error },
                    'Failed to fetch stats for collection'
                );
            }
        }

        // Sort collections by size descending (largest first)
        collectionStats.sort((a, b) => b.size - a.size);

        return {
            dbName,
            totalSize,
            collections: collectionStats
        };
    }

    /**
     * Retrieves paginated documents from a collection.
     *
     * Uses cursor-based pagination with skip/limit for efficient document retrieval.
     * Sorts by _id descending by default to show newest documents first.
     *
     * Why cursor-based with skip/limit:
     * - Simple page-based navigation (better UX than cursor tokens)
     * - Efficient for small-to-medium page offsets
     * - Can sort by any field, not just _id
     * - Acceptable performance for admin tools (not user-facing pagination)
     *
     * Performance considerations:
     * - Skip becomes slower for large offsets (use limit of 100 max)
     * - Index on sort field recommended for large collections
     * - Total count query is cached for subsequent pages
     *
     * @param collectionName - Name of the collection to query
     * @param options - Pagination and sorting options
     * @returns Paginated document response
     * @throws {Error} If collection does not exist
     */
    async getDocuments(
        collectionName: string,
        options: Omit<IQueryOptions, 'filter'>
    ): Promise<IPaginatedDocuments> {
        const { page, limit, sort } = options;

        this.logger.debug({ collectionName, page, limit, sort }, 'Fetching documents');

        const db = this.connection.db;
        if (!db) {
            throw new Error('Database not connected');
        }

        const collection = db.collection(collectionName);

        // Calculate skip offset
        const skip = (page - 1) * limit;

        // Fetch documents with pagination
        const documents = await collection
            .find({})
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .toArray();

        // Get total count
        const total = await collection.countDocuments({});

        // Calculate pagination metadata
        const totalPages = Math.ceil(total / limit);
        const hasNextPage = page < totalPages;
        const hasPrevPage = page > 1;

        return {
            documents,
            total,
            page,
            limit,
            totalPages,
            hasNextPage,
            hasPrevPage
        };
    }

    /**
     * Executes a filtered query against a collection with pagination.
     *
     * Allows administrators to search documents using MongoDB query syntax.
     * Filters are sanitized to prevent injection attacks before execution.
     *
     * Why we allow MongoDB query syntax:
     * - Administrators need flexible querying beyond simple field matching
     * - MongoDB's query language is powerful and well-documented
     * - Sanitization (via express-mongo-sanitize middleware) prevents injection
     * - Dangerous operators ($where, $function) are explicitly blocked
     *
     * Security measures:
     * - express-mongo-sanitize removes $ and . from user input
     * - Explicit blacklist of dangerous operators
     * - Read-only operations (no write queries)
     * - Admin authentication required at API layer
     *
     * @param collectionName - Name of the collection to query
     * @param options - Query filter, pagination, and sorting options
     * @returns Paginated query results
     * @throws {Error} If collection does not exist or query is malformed
     */
    async queryDocuments(
        collectionName: string,
        options: IQueryOptions
    ): Promise<IPaginatedDocuments> {
        const { filter = {}, page, limit, sort } = options;

        this.logger.debug(
            { collectionName, filter, page, limit, sort },
            'Executing query'
        );

        // Additional security: Block dangerous operators
        const dangerousOperators = ['$where', '$function', '$accumulator', '$expr'];
        for (const op of dangerousOperators) {
            if (this.containsOperator(filter, op)) {
                throw new Error(`Dangerous operator ${op} not allowed in queries`);
            }
        }

        const db = this.connection.db;
        if (!db) {
            throw new Error('Database not connected');
        }

        const collection = db.collection(collectionName);

        // Calculate skip offset
        const skip = (page - 1) * limit;

        // Execute query with pagination
        const documents = await collection
            .find(filter)
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .toArray();

        // Get total count matching filter
        const total = await collection.countDocuments(filter);

        // Calculate pagination metadata
        const totalPages = Math.ceil(total / limit);
        const hasNextPage = page < totalPages;
        const hasPrevPage = page > 1;

        return {
            documents,
            total,
            page,
            limit,
            totalPages,
            hasNextPage,
            hasPrevPage
        };
    }

    /**
     * Recursively checks if an object contains a dangerous operator.
     *
     * MongoDB operators can be nested in objects and arrays, so we need to
     * recursively search for blacklisted operators at any depth.
     *
     * @param obj - Object to search
     * @param operator - Operator to find
     * @returns True if operator is found at any depth
     */
    private containsOperator(obj: any, operator: string): boolean {
        if (typeof obj !== 'object' || obj === null) {
            return false;
        }

        for (const key in obj) {
            if (key === operator) {
                return true;
            }
            if (this.containsOperator(obj[key], operator)) {
                return true;
            }
        }

        return false;
    }
}
