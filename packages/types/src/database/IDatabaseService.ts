import type { Collection, Document, Filter, UpdateFilter, IndexDescription } from 'mongodb';

/**
 * Database service interface providing unified database access across the application.
 *
 * Provides a consistent abstraction over MongoDB that supports three access patterns:
 *
 * **Tier 1 - Raw Collections:**
 * Direct access to MongoDB native driver collections for maximum flexibility.
 * Use for: Plugins, complex queries, bulk operations.
 *
 * **Tier 2 - Mongoose Model Registry:**
 * Optional registration of Mongoose models to preserve schema validation, defaults,
 * hooks, virtuals, and other Mongoose features. When a model is registered, convenience
 * methods automatically use it instead of raw collection access.
 * Use for: Complex entities requiring validation (Transactions, SystemConfig, etc.)
 *
 * **Tier 3 - Convenience Methods:**
 * Smart helper methods that prefer Mongoose models when available, falling back to
 * raw collection access. Reduces boilerplate for common CRUD operations.
 * Use for: Standard queries, updates, deletes.
 *
 * Why this abstraction exists:
 * - **Testability** - Services can be tested with mock database implementations
 * - **Consistency** - All database access follows the same patterns
 * - **Flexibility** - Choose raw collections or Mongoose models based on needs
 * - **Decoupling** - Services depend on interfaces, not Mongoose directly
 * - **Namespace isolation** - Plugins get automatic collection prefixing
 *
 * @example
 * ```typescript
 * // Using raw collections (plugins)
 * const collection = database.getCollection('alerts');
 * await collection.insertOne({ userId: '123', type: 'whale' });
 *
 * // Using registered Mongoose model (services)
 * database.registerModel('system_config', SystemConfigModel);
 * const config = await database.findOne('system_config', { key: 'system' });
 *
 * // Key-value storage
 * await database.set('lastSync', new Date());
 * const lastSync = await database.get<Date>('lastSync');
 * ```
 */
export interface IDatabaseService {
    /**
     * Get a MongoDB collection for direct access.
     *
     * Returns the native MongoDB collection object from the driver, allowing
     * full control over queries, aggregations, and bulk operations. Collection
     * names may be automatically prefixed for namespace isolation.
     *
     * Why use this:
     * - Complex aggregation pipelines
     * - Bulk operations (bulkWrite, insertMany)
     * - Advanced query options not available in convenience methods
     * - Maximum flexibility for plugin-specific logic
     *
     * @param name - Logical collection name
     * @returns MongoDB native collection
     *
     * @example
     * ```typescript
     * const transactions = database.getCollection<TransactionDoc>('transactions');
     * const cursor = transactions.aggregate([
     *     { $match: { blockNumber: { $gte: 1000 } } },
     *     { $group: { _id: '$type', count: { $sum: 1 } } }
     * ]);
     * ```
     */
    getCollection<T extends Document = Document>(name: string): Collection<T>;

    /**
     * Register a Mongoose model with the database service.
     *
     * When a Mongoose model is registered for a collection, convenience methods
     * (find, findOne, etc.) will automatically use the model instead of raw
     * collection access. This preserves Mongoose benefits like schema validation,
     * defaults, middleware hooks, and virtuals.
     *
     * Why use this:
     * - Preserve Mongoose schema validation on writes
     * - Ensure default values are applied
     * - Trigger pre/post middleware hooks
     * - Access virtuals and instance methods
     *
     * @param collectionName - Logical collection name matching the model
     * @param model - Mongoose model instance
     *
     * @example
     * ```typescript
     * // In service constructor
     * database.registerModel('system_config', SystemConfigModel);
     *
     * // Now convenience methods use the model automatically
     * const config = await database.findOne('system_config', { key: 'system' });
     * // ^ Uses SystemConfigModel.findOne() with all Mongoose features
     * ```
     */
    registerModel<T extends Document = Document>(collectionName: string, model: any): void;

    /**
     * Get a registered Mongoose model.
     *
     * Retrieves a previously registered Mongoose model for advanced operations
     * that require the full model API (e.g., populate, virtuals, custom methods).
     *
     * @param collectionName - Logical collection name
     * @returns Mongoose model if registered, undefined otherwise
     *
     * @example
     * ```typescript
     * const model = database.getModel<TransactionDoc>('transactions');
     * if (model) {
     *     const result = await model.findOne({ txId }).populate('relatedDocs');
     * }
     * ```
     */
    getModel<T extends Document = Document>(collectionName: string): any | undefined;

    /**
     * Get a value from the key-value store.
     *
     * Provides simple key-value storage backed by a special `_kv` collection.
     * Useful for storing configuration, timestamps, flags, and other simple data
     * without managing separate collections.
     *
     * Why use this:
     * - Simple configuration storage
     * - Timestamps (lastSync, lastUpdate)
     * - Feature flags and settings
     * - Small datasets that don't need their own collection
     *
     * @param key - The key to retrieve
     * @returns The stored value, or undefined if key doesn't exist
     *
     * @example
     * ```typescript
     * const lastSync = await database.get<Date>('lastSyncTime');
     * const config = await database.get<{ threshold: number }>('alertConfig');
     * ```
     */
    get<T = any>(key: string): Promise<T | undefined>;

    /**
     * Set a value in the key-value store.
     *
     * Upserts (insert or update) a key-value pair. Values must be JSON-serializable.
     * Stored in a special `_kv` collection managed automatically.
     *
     * @param key - The key to store under
     * @param value - The value to store (must be JSON-serializable)
     *
     * @example
     * ```typescript
     * await database.set('lastSyncTime', new Date());
     * await database.set('config', { threshold: 1000, enabled: true });
     * ```
     */
    set<T = any>(key: string, value: T): Promise<void>;

    /**
     * Delete a key from the key-value store.
     *
     * @param key - The key to delete
     * @returns True if the key existed and was deleted, false otherwise
     *
     * @example
     * ```typescript
     * const deleted = await database.delete('tempCache');
     * ```
     */
    delete(key: string): Promise<boolean>;

    /**
     * Create an index on a collection.
     *
     * Indexes improve query performance and can enforce uniqueness constraints.
     * Typically called during plugin installation or service initialization.
     *
     * Why use this:
     * - Speed up frequent queries
     * - Enforce unique constraints
     * - Enable TTL (time-to-live) expiration
     * - Support text search
     *
     * @param collectionName - Logical collection name
     * @param indexSpec - MongoDB index specification
     * @param options - Index options (unique, sparse, TTL, etc.)
     *
     * @example
     * ```typescript
     * // Single field index
     * await database.createIndex('transactions', { txId: 1 }, { unique: true });
     *
     * // Compound index
     * await database.createIndex('transactions', { blockNumber: 1, timestamp: -1 });
     *
     * // TTL index (auto-delete after 30 days)
     * await database.createIndex('logs', { timestamp: 1 }, { expireAfterSeconds: 2592000 });
     * ```
     */
    createIndex(
        collectionName: string,
        indexSpec: IndexDescription,
        options?: { unique?: boolean; sparse?: boolean; expireAfterSeconds?: number }
    ): Promise<void>;

    /**
     * Count documents matching a filter.
     *
     * Efficient counting without retrieving documents. Prefers registered Mongoose
     * model if available, falls back to raw collection.
     *
     * @param collectionName - Logical collection name
     * @param filter - MongoDB query filter
     * @returns Count of matching documents
     *
     * @example
     * ```typescript
     * const activeAlerts = await database.count('alerts', { dismissed: false });
     * const recentTxs = await database.count('transactions', {
     *     timestamp: { $gte: yesterday }
     * });
     * ```
     */
    count<T extends Document = Document>(
        collectionName: string,
        filter: Filter<T>
    ): Promise<number>;

    /**
     * Find documents matching a filter.
     *
     * Retrieves multiple documents with optional pagination and sorting. Prefers
     * registered Mongoose model if available (uses .lean() for performance),
     * falls back to raw collection.
     *
     * @param collectionName - Logical collection name
     * @param filter - MongoDB query filter
     * @param options - Query options (limit, skip, sort)
     * @returns Array of matching documents
     *
     * @example
     * ```typescript
     * // Recent transactions
     * const txs = await database.find('transactions',
     *     { blockNumber: { $gte: 1000 } },
     *     { limit: 100, sort: { timestamp: -1 } }
     * );
     *
     * // Paginated results
     * const page2 = await database.find('alerts',
     *     { dismissed: false },
     *     { skip: 20, limit: 20, sort: { timestamp: -1 } }
     * );
     * ```
     */
    find<T extends Document = Document>(
        collectionName: string,
        filter: Filter<T>,
        options?: { limit?: number; skip?: number; sort?: Record<string, 1 | -1> }
    ): Promise<T[]>;

    /**
     * Find a single document matching a filter.
     *
     * Returns the first document matching the filter, or null if none found.
     * Prefers registered Mongoose model if available (uses .lean() for performance),
     * falls back to raw collection.
     *
     * @param collectionName - Logical collection name
     * @param filter - MongoDB query filter
     * @returns The first matching document, or null
     *
     * @example
     * ```typescript
     * const config = await database.findOne('system_config', { key: 'system' });
     * const user = await database.findOne('users', { email: 'user@example.com' });
     * ```
     */
    findOne<T extends Document = Document>(
        collectionName: string,
        filter: Filter<T>
    ): Promise<T | null>;

    /**
     * Insert a single document into a collection.
     *
     * Prefers registered Mongoose model if available (applies validation and defaults),
     * falls back to raw collection insert.
     *
     * Common errors to handle:
     * - Duplicate key errors (code 11000) when violating unique indexes
     * - Validation errors from Mongoose schemas
     *
     * @param collectionName - Logical collection name
     * @param document - Document to insert
     * @returns The inserted document ID
     *
     * @example
     * ```typescript
     * try {
     *     const id = await database.insertOne('transactions', {
     *         txId: 'abc123',
     *         blockNumber: 1000,
     *         timestamp: new Date()
     *     });
     * } catch (error) {
     *     if (error.code === 11000) {
     *         logger.warn('Transaction already exists');
     *     } else {
     *         throw error;
     *     }
     * }
     * ```
     */
    insertOne<T extends Document = Document>(
        collectionName: string,
        document: T
    ): Promise<any>;

    /**
     * Update multiple documents matching a filter.
     *
     * Applies update operations to all matching documents. Prefers registered
     * Mongoose model if available, falls back to raw collection.
     *
     * @param collectionName - Logical collection name
     * @param filter - MongoDB query filter
     * @param update - MongoDB update operations ($set, $inc, etc.)
     * @returns Number of documents modified
     *
     * @example
     * ```typescript
     * // Dismiss old alerts
     * const count = await database.updateMany('alerts',
     *     { timestamp: { $lt: cutoffDate } },
     *     { $set: { dismissed: true } }
     * );
     *
     * // Increment counters
     * await database.updateMany('stats',
     *     { type: 'whale' },
     *     { $inc: { count: 1 } }
     * );
     * ```
     */
    updateMany<T extends Document = Document>(
        collectionName: string,
        filter: Filter<T>,
        update: UpdateFilter<T>
    ): Promise<number>;

    /**
     * Delete multiple documents matching a filter.
     *
     * Removes all documents matching the filter. Prefers registered Mongoose
     * model if available, falls back to raw collection.
     *
     * @param collectionName - Logical collection name
     * @param filter - MongoDB query filter
     * @returns Number of documents deleted
     *
     * @example
     * ```typescript
     * // Purge old logs
     * const deleted = await database.deleteMany('logs',
     *     { timestamp: { $lt: cutoffDate } }
     * );
     *
     * // Clear plugin data
     * await database.deleteMany('alerts', { dismissed: true });
     * ```
     */
    deleteMany<T extends Document = Document>(
        collectionName: string,
        filter: Filter<T>
    ): Promise<number>;
}
