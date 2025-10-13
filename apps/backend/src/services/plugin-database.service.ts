import mongoose from 'mongoose';
import type { Collection, Document, Filter, UpdateFilter, IndexDescription, CreateIndexesOptions } from 'mongodb';
import type { IPluginDatabase } from '@tronrelic/types';
import { logger } from '../lib/logger.js';

/**
 * Plugin-scoped database access implementation.
 *
 * Provides plugins with isolated database access by automatically prefixing all collection
 * names with the plugin ID. This prevents naming conflicts between plugins and ensures
 * data isolation. The service wraps MongoDB native driver collections for maximum flexibility
 * while providing convenience methods for common operations.
 *
 * Why this exists:
 * - **Namespace isolation** - Each plugin gets its own collection namespace
 * - **Zero configuration** - Plugins access collections by logical names
 * - **Flexibility** - Direct MongoDB collection access for complex queries
 * - **Convenience** - Helper methods for common operations (get/set/find)
 * - **Safety** - Collection names are validated and sanitized
 *
 * @example
 * ```typescript
 * // In plugin init:
 * const db = new PluginDatabaseService('whale-alerts');
 *
 * // Access collection (becomes "plugin_whale-alerts_subscriptions")
 * const subscriptions = db.getCollection('subscriptions');
 * await subscriptions.insertOne({ userId: '123', enabled: true });
 *
 * // Simple key-value storage
 * await db.set('lastSync', new Date());
 * const lastSync = await db.get<Date>('lastSync');
 * ```
 */
export class PluginDatabaseService implements IPluginDatabase {
    private readonly pluginId: string;
    private readonly collectionPrefix: string;

    /**
     * Create a plugin-scoped database service.
     *
     * The plugin ID is used to automatically prefix all collection names, ensuring
     * isolation between plugins and preventing naming conflicts.
     *
     * @param pluginId - The unique plugin identifier (from manifest)
     */
    constructor(pluginId: string) {
        this.pluginId = pluginId;
        this.collectionPrefix = `plugin_${pluginId}_`;
    }

    /**
     * Get the physical collection name with plugin prefix.
     *
     * Converts logical collection names (e.g., "subscriptions") to physical names
     * (e.g., "plugin_whale-alerts_subscriptions") to ensure isolation.
     *
     * @param logicalName - The logical collection name used by the plugin
     * @returns The physical collection name in MongoDB
     */
    private getPhysicalCollectionName(logicalName: string): string {
        // Validate collection name
        if (!logicalName || typeof logicalName !== 'string') {
            throw new Error('Collection name must be a non-empty string');
        }

        // Sanitize to prevent injection or invalid names
        const sanitized = logicalName.replace(/[^a-zA-Z0-9_-]/g, '_');

        return `${this.collectionPrefix}${sanitized}`;
    }

    /**
     * Get a plugin-scoped MongoDB collection.
     *
     * Returns the native MongoDB collection object for maximum flexibility.
     * The collection name is automatically prefixed with the plugin ID.
     *
     * @param name - Logical collection name
     * @returns MongoDB native collection
     */
    public getCollection<T extends Document = Document>(name: string): Collection<T> {
        const physicalName = this.getPhysicalCollectionName(name);
        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('MongoDB connection not established');
        }
        return db.collection<T>(physicalName) as Collection<T>;
    }

    /**
     * Get a value from the plugin's key-value store.
     *
     * Uses a special `_kv` collection to store simple key-value pairs.
     * This is a convenience method for plugins that need simple storage
     * without managing collections.
     *
     * @param key - The key to retrieve
     * @returns The stored value, or undefined if not found
     */
    public async get<T = any>(key: string): Promise<T | undefined> {
        try {
            const collection = this.getCollection<{ key: string; value: T }>('_kv');
            const doc = await collection.findOne({ key } as Filter<{ key: string; value: T }>);
            return doc?.value;
        } catch (error) {
            logger.error({ error, pluginId: this.pluginId, key }, 'Failed to get key from plugin KV store');
            return undefined;
        }
    }

    /**
     * Set a value in the plugin's key-value store.
     *
     * Upserts (insert or update) a key-value pair in the special `_kv` collection.
     * Values must be JSON-serializable.
     *
     * @param key - The key to store under
     * @param value - The value to store
     */
    public async set<T = any>(key: string, value: T): Promise<void> {
        try {
            const collection = this.getCollection<{ key: string; value: T }>('_kv');
            await collection.updateOne(
                { key } as Filter<{ key: string; value: T }>,
                { $set: { key, value } } as UpdateFilter<{ key: string; value: T }>,
                { upsert: true }
            );
        } catch (error) {
            logger.error({ error, pluginId: this.pluginId, key }, 'Failed to set key in plugin KV store');
            throw error;
        }
    }

    /**
     * Delete a key from the plugin's key-value store.
     *
     * @param key - The key to delete
     * @returns True if the key existed and was deleted
     */
    public async delete(key: string): Promise<boolean> {
        try {
            const collection = this.getCollection<{ key: string; value: any }>('_kv');
            const result = await collection.deleteOne({ key } as Filter<{ key: string; value: any }>);
            return result.deletedCount > 0;
        } catch (error) {
            logger.error({ error, pluginId: this.pluginId, key }, 'Failed to delete key from plugin KV store');
            return false;
        }
    }

    /**
     * Create an index on a collection.
     *
     * This is typically called during the plugin's install() lifecycle hook
     * to set up indexes for optimal query performance.
     *
     * @param collectionName - Logical collection name
     * @param indexSpec - MongoDB index specification
     * @param options - Index options (unique, sparse, TTL, etc.)
     */
    public async createIndex(
        collectionName: string,
        indexSpec: IndexDescription,
        options?: CreateIndexesOptions
    ): Promise<void> {
        try {
            const collection = this.getCollection(collectionName);
            await collection.createIndex(indexSpec as any, options);
            logger.info(
                { pluginId: this.pluginId, collection: collectionName, indexSpec },
                'Created plugin collection index'
            );
        } catch (error) {
            logger.error(
                { error, pluginId: this.pluginId, collection: collectionName, indexSpec },
                'Failed to create plugin collection index'
            );
            throw error;
        }
    }

    /**
     * Count documents in a collection.
     *
     * @param collectionName - Logical collection name
     * @param filter - MongoDB query filter
     * @returns Count of matching documents
     */
    public async count<T extends Document = Document>(
        collectionName: string,
        filter: Filter<T>
    ): Promise<number> {
        try {
            const collection = this.getCollection<T>(collectionName);
            return await collection.countDocuments(filter);
        } catch (error) {
            logger.error(
                { error, pluginId: this.pluginId, collection: collectionName },
                'Failed to count documents'
            );
            throw error;
        }
    }

    /**
     * Find documents in a collection.
     *
     * @param collectionName - Logical collection name
     * @param filter - MongoDB query filter
     * @param options - Query options (limit, sort, skip)
     * @returns Array of matching documents
     */
    public async find<T extends Document = Document>(
        collectionName: string,
        filter: Filter<T>,
        options?: { limit?: number; skip?: number; sort?: Record<string, 1 | -1> }
    ): Promise<T[]> {
        try {
            const collection = this.getCollection<T>(collectionName);
            let cursor = collection.find(filter);

            if (options?.sort) {
                cursor = cursor.sort(options.sort);
            }
            if (options?.skip) {
                cursor = cursor.skip(options.skip);
            }
            if (options?.limit) {
                cursor = cursor.limit(options.limit);
            }

            return (await cursor.toArray()) as T[];
        } catch (error) {
            logger.error(
                { error, pluginId: this.pluginId, collection: collectionName },
                'Failed to find documents'
            );
            throw error;
        }
    }

    /**
     * Find a single document in a collection.
     *
     * @param collectionName - Logical collection name
     * @param filter - MongoDB query filter
     * @returns The first matching document, or null
     */
    public async findOne<T extends Document = Document>(
        collectionName: string,
        filter: Filter<T>
    ): Promise<T | null> {
        try {
            const collection = this.getCollection<T>(collectionName);
            return (await collection.findOne(filter)) as T | null;
        } catch (error) {
            logger.error(
                { error, pluginId: this.pluginId, collection: collectionName },
                'Failed to find document'
            );
            throw error;
        }
    }

    /**
     * Insert a single document into a collection.
     *
     * @param collectionName - Logical collection name
     * @param document - Document to insert
     * @returns The inserted document ID
     */
    public async insertOne<T extends Document = Document>(
        collectionName: string,
        document: T
    ): Promise<any> {
        try {
            const collection = this.getCollection<T>(collectionName);
            const result = await collection.insertOne(document as any);
            return result.insertedId;
        } catch (error) {
            logger.error(
                { error, pluginId: this.pluginId, collection: collectionName },
                'Failed to insert document'
            );
            throw error;
        }
    }

    /**
     * Update multiple documents in a collection.
     *
     * @param collectionName - Logical collection name
     * @param filter - MongoDB query filter
     * @param update - MongoDB update operations
     * @returns Number of documents modified
     */
    public async updateMany<T extends Document = Document>(
        collectionName: string,
        filter: Filter<T>,
        update: UpdateFilter<T>
    ): Promise<number> {
        try {
            const collection = this.getCollection<T>(collectionName);
            const result = await collection.updateMany(filter, update);
            return result.modifiedCount;
        } catch (error) {
            logger.error(
                { error, pluginId: this.pluginId, collection: collectionName },
                'Failed to update documents'
            );
            throw error;
        }
    }

    /**
     * Delete multiple documents from a collection.
     *
     * @param collectionName - Logical collection name
     * @param filter - MongoDB query filter
     * @returns Number of documents deleted
     */
    public async deleteMany<T extends Document = Document>(
        collectionName: string,
        filter: Filter<T>
    ): Promise<number> {
        try {
            const collection = this.getCollection<T>(collectionName);
            const result = await collection.deleteMany(filter);
            return result.deletedCount;
        } catch (error) {
            logger.error(
                { error, pluginId: this.pluginId, collection: collectionName },
                'Failed to delete documents'
            );
            throw error;
        }
    }
}
