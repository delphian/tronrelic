import type { Collection, Document, Filter, UpdateFilter, IndexDescription } from 'mongodb';

/**
 * Plugin-scoped database access interface.
 *
 * Provides plugins with safe, scoped access to MongoDB collections. All collections
 * are automatically prefixed with the plugin ID to prevent naming conflicts and ensure
 * data isolation between plugins.
 *
 * Example: A plugin with id "whale-alerts" accessing collection "subscriptions"
 * will actually use the MongoDB collection "plugin_whale-alerts_subscriptions".
 */
export interface IPluginDatabase {
    /**
     * Get a plugin-scoped MongoDB collection.
     *
     * Collections are automatically prefixed with `plugin_{pluginId}_` to ensure
     * isolation. Plugins work with logical collection names while the database
     * uses prefixed physical collection names.
     *
     * @param name - Logical collection name (e.g., "subscriptions", "alerts")
     * @returns MongoDB collection object for direct queries
     *
     * @example
     * ```typescript
     * const subscriptions = database.getCollection('subscriptions');
     * await subscriptions.insertOne({ userId: '123', enabled: true });
     * ```
     */
    getCollection<T extends Document = Document>(name: string): Collection<T>;

    /**
     * Simple key-value get operation.
     *
     * Retrieves a value from the plugin's key-value store. This is a convenience
     * method for simple storage without needing to manage collections directly.
     * Uses a special `_kv` collection under the hood.
     *
     * @param key - The key to retrieve
     * @returns The stored value, or undefined if key doesn't exist
     *
     * @example
     * ```typescript
     * const lastSync = await database.get<Date>('lastSyncTime');
     * ```
     */
    get<T = any>(key: string): Promise<T | undefined>;

    /**
     * Simple key-value set operation.
     *
     * Stores a value in the plugin's key-value store. This is a convenience
     * method for simple storage without needing to manage collections directly.
     * Values are automatically upserted (insert or update).
     *
     * @param key - The key to store under
     * @param value - The value to store (must be JSON-serializable)
     *
     * @example
     * ```typescript
     * await database.set('lastSyncTime', new Date());
     * await database.set('config', { threshold: 1000 });
     * ```
     */
    set<T = any>(key: string, value: T): Promise<void>;

    /**
     * Delete a key from the key-value store.
     *
     * Removes a key and its value from the plugin's key-value store.
     *
     * @param key - The key to delete
     * @returns True if the key existed and was deleted, false otherwise
     *
     * @example
     * ```typescript
     * await database.delete('tempCache');
     * ```
     */
    delete(key: string): Promise<boolean>;

    /**
     * Create an index on a collection.
     *
     * This is a convenience method for creating indexes during plugin installation.
     * Indexes improve query performance but should be created thoughtfully.
     *
     * @param collectionName - Logical collection name
     * @param indexSpec - MongoDB index specification
     *
     * @example
     * ```typescript
     * // Single field index
     * await database.createIndex('alerts', { timestamp: -1 });
     *
     * // Compound index
     * await database.createIndex('subscriptions', { userId: 1, alertType: 1 });
     *
     * // Unique index
     * await database.createIndex('users', { email: 1 }, { unique: true });
     * ```
     */
    createIndex(
        collectionName: string,
        indexSpec: IndexDescription,
        options?: { unique?: boolean; sparse?: boolean; expireAfterSeconds?: number }
    ): Promise<void>;

    /**
     * Count documents in a collection matching a filter.
     *
     * Convenience method for counting documents without retrieving them.
     *
     * @param collectionName - Logical collection name
     * @param filter - MongoDB query filter
     * @returns Count of matching documents
     *
     * @example
     * ```typescript
     * const activeAlerts = await database.count('alerts', { dismissed: false });
     * ```
     */
    count<T extends Document = Document>(
        collectionName: string,
        filter: Filter<T>
    ): Promise<number>;

    /**
     * Find documents in a collection.
     *
     * Convenience method for querying documents with common options.
     *
     * @param collectionName - Logical collection name
     * @param filter - MongoDB query filter
     * @param options - Query options (limit, sort, etc.)
     * @returns Array of matching documents
     *
     * @example
     * ```typescript
     * const recentAlerts = await database.find('alerts',
     *     { dismissed: false },
     *     { limit: 10, sort: { timestamp: -1 } }
     * );
     * ```
     */
    find<T extends Document = Document>(
        collectionName: string,
        filter: Filter<T>,
        options?: { limit?: number; skip?: number; sort?: Record<string, 1 | -1> }
    ): Promise<T[]>;

    /**
     * Find a single document in a collection.
     *
     * Convenience method for retrieving one document.
     *
     * @param collectionName - Logical collection name
     * @param filter - MongoDB query filter
     * @returns The first matching document, or null if none found
     *
     * @example
     * ```typescript
     * const user = await database.findOne('subscriptions', { userId: '123' });
     * ```
     */
    findOne<T extends Document = Document>(
        collectionName: string,
        filter: Filter<T>
    ): Promise<T | null>;

    /**
     * Insert a single document into a collection.
     *
     * Convenience method for inserting one document.
     *
     * @param collectionName - Logical collection name
     * @param document - Document to insert
     * @returns The inserted document ID
     *
     * @example
     * ```typescript
     * const id = await database.insertOne('alerts', {
     *     userId: '123',
     *     type: 'whale',
     *     timestamp: new Date()
     * });
     * ```
     */
    insertOne<T extends Document = Document>(
        collectionName: string,
        document: T
    ): Promise<any>;

    /**
     * Update documents in a collection.
     *
     * Convenience method for updating multiple documents.
     *
     * @param collectionName - Logical collection name
     * @param filter - MongoDB query filter
     * @param update - MongoDB update operations
     * @returns Number of documents modified
     *
     * @example
     * ```typescript
     * await database.updateMany('alerts',
     *     { dismissed: false, timestamp: { $lt: oldDate } },
     *     { $set: { dismissed: true } }
     * );
     * ```
     */
    updateMany<T extends Document = Document>(
        collectionName: string,
        filter: Filter<T>,
        update: UpdateFilter<T>
    ): Promise<number>;

    /**
     * Delete documents from a collection.
     *
     * Convenience method for deleting multiple documents.
     *
     * @param collectionName - Logical collection name
     * @param filter - MongoDB query filter
     * @returns Number of documents deleted
     *
     * @example
     * ```typescript
     * await database.deleteMany('alerts', { dismissed: true, timestamp: { $lt: oldDate } });
     * ```
     */
    deleteMany<T extends Document = Document>(
        collectionName: string,
        filter: Filter<T>
    ): Promise<number>;
}
