import mongoose from 'mongoose';
import type { Collection, Document, Filter, UpdateFilter, IndexDescription, CreateIndexesOptions } from 'mongodb';
import type { IDatabaseService } from '@tronrelic/types';
import { logger } from '../../lib/logger.js';

/**
 * Database service providing unified database access across the application.
 *
 * Implements a three-tier access pattern:
 *
 * **Tier 1 - Raw Collections:**
 * Direct MongoDB native driver access for maximum flexibility. Used by plugins
 * and services requiring complex queries, aggregations, or bulk operations.
 *
 * **Tier 2 - Mongoose Model Registry:**
 * Optional registration of Mongoose models to preserve schema validation, defaults,
 * hooks, and virtuals. When a model is registered, convenience methods automatically
 * prefer it over raw collection access.
 *
 * **Tier 3 - Convenience Methods:**
 * Smart helper methods that check the model registry first, falling back to raw
 * collection access. Reduces boilerplate for standard CRUD operations.
 *
 * Why this architecture:
 * - **Flexibility** - Plugins get raw collections, services get Mongoose benefits
 * - **Performance** - Uses .lean() queries when Mongoose isn't needed for reads
 * - **Type safety** - MongoDB driver provides excellent TypeScript support
 * - **Testability** - Interface allows mock implementations in tests
 * - **Namespace isolation** - Optional collection prefixing for plugins
 *
 * Collection name prefixing:
 * - Core services: No prefix (e.g., "system_config", "transactions")
 * - Plugins: Automatic prefix (e.g., "plugin_whale-alerts_subscriptions")
 *
 * @example
 * ```typescript
 * // Core service with Mongoose model
 * const db = new DatabaseService();
 * db.registerModel('system_config', SystemConfigModel);
 * const config = await db.findOne('system_config', { key: 'system' });
 *
 * // Plugin with raw collections
 * const pluginDb = new DatabaseService({ prefix: 'plugin_whale-alerts_' });
 * const collection = pluginDb.getCollection('subscriptions');
 * await collection.insertOne({ userId: '123', enabled: true });
 * ```
 */
export class DatabaseService implements IDatabaseService {
    private readonly collectionPrefix: string;
    private readonly models: Map<string, any> = new Map();

    /**
     * Create a database service instance.
     *
     * Core services typically pass no options (no prefix), while plugins
     * pass a prefix to isolate their collections from other plugins and
     * core services.
     *
     * @param options - Configuration options
     * @param options.prefix - Optional prefix for all collection names
     *
     * @example
     * ```typescript
     * // Core service
     * const db = new DatabaseService();
     *
     * // Plugin with namespace isolation
     * const pluginDb = new DatabaseService({ prefix: 'plugin_whale-alerts_' });
     * ```
     */
    constructor(options?: { prefix?: string }) {
        this.collectionPrefix = options?.prefix || '';
    }

    /**
     * Get the physical collection name with optional prefix.
     *
     * Converts logical collection names (e.g., "subscriptions") to physical names
     * (e.g., "plugin_whale-alerts_subscriptions") when a prefix is configured.
     * Sanitizes collection names to prevent injection or invalid characters.
     *
     * @param logicalName - The logical collection name used by the caller
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
     * Get a MongoDB collection for direct access.
     *
     * Returns the native MongoDB collection object from the driver, allowing
     * full control over queries, aggregations, and bulk operations. Collection
     * names are automatically prefixed if configured.
     *
     * @param name - Logical collection name
     * @returns MongoDB native collection
     * @throws Error if MongoDB connection not established
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
     * Register a Mongoose model with the database service.
     *
     * When a model is registered, convenience methods (find, findOne, etc.)
     * will automatically use the model instead of raw collection access.
     * This preserves Mongoose benefits like schema validation, defaults,
     * middleware hooks, and virtuals.
     *
     * Registration is optional and typically done in service constructors.
     *
     * @param collectionName - Logical collection name matching the model
     * @param model - Mongoose model instance
     *
     * @example
     * ```typescript
     * // In SystemConfigService constructor
     * this.database.registerModel('system_config', SystemConfigModel);
     * ```
     */
    public registerModel<T extends Document = Document>(collectionName: string, model: any): void {
        this.models.set(collectionName, model);
        logger.debug(
            { collection: collectionName, modelName: model.modelName },
            'Registered Mongoose model with database service'
        );
    }

    /**
     * Get a registered Mongoose model.
     *
     * Retrieves a previously registered model for operations requiring
     * the full Mongoose API (populate, virtuals, custom methods).
     *
     * @param collectionName - Logical collection name
     * @returns Mongoose model if registered, undefined otherwise
     */
    public getModel<T extends Document = Document>(collectionName: string): any | undefined {
        return this.models.get(collectionName);
    }

    /**
     * Get a value from the key-value store.
     *
     * Uses a special `_kv` collection to store simple key-value pairs.
     * Useful for configuration, timestamps, flags, and other simple data.
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
            logger.error({ error, prefix: this.collectionPrefix, key }, 'Failed to get key from KV store');
            return undefined;
        }
    }

    /**
     * Set a value in the key-value store.
     *
     * Upserts (insert or update) a key-value pair. Values must be JSON-serializable.
     * Verifies that MongoDB acknowledged the write operation.
     *
     * @param key - The key to store under
     * @param value - The value to store
     * @throws Error if MongoDB does not acknowledge the write
     */
    public async set<T = any>(key: string, value: T): Promise<void> {
        const collection = this.getCollection<{ key: string; value: T }>('_kv');
        const result = await collection.updateOne(
            { key } as Filter<{ key: string; value: T }>,
            { $set: { key, value } } as UpdateFilter<{ key: string; value: T }>,
            { upsert: true }
        );

        // Verify write was acknowledged by MongoDB
        if (!result.acknowledged) {
            throw new Error('MongoDB write was not acknowledged');
        }

        // Verify something was actually modified or inserted
        if (result.modifiedCount === 0 && result.upsertedCount === 0) {
            logger.warn(
                { prefix: this.collectionPrefix, key, result },
                'updateOne completed but no documents were modified or upserted'
            );
        }
    }

    /**
     * Delete a key from the key-value store.
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
            logger.error({ error, prefix: this.collectionPrefix, key }, 'Failed to delete key from KV store');
            return false;
        }
    }

    /**
     * Create an index on a collection.
     *
     * Typically called during service initialization or plugin installation
     * to optimize query performance.
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
        const collection = this.getCollection(collectionName);
        await collection.createIndex(indexSpec as any, options);
        logger.info(
            { prefix: this.collectionPrefix, collection: collectionName, indexSpec },
            'Created collection index'
        );
    }

    /**
     * Count documents matching a filter.
     *
     * Prefers registered Mongoose model if available, falls back to raw collection.
     *
     * @param collectionName - Logical collection name
     * @param filter - MongoDB query filter
     * @returns Count of matching documents
     */
    public async count<T extends Document = Document>(
        collectionName: string,
        filter: Filter<T>
    ): Promise<number> {
        // Prefer Mongoose model if registered
        const model = this.models.get(collectionName);
        if (model) {
            return await model.countDocuments(filter);
        }

        // Fallback to raw collection
        const collection = this.getCollection<T>(collectionName);
        return await collection.countDocuments(filter);
    }

    /**
     * Find documents matching a filter.
     *
     * Prefers registered Mongoose model if available (uses .lean() for performance),
     * falls back to raw collection access.
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
        // Prefer Mongoose model if registered
        const model = this.models.get(collectionName);
        if (model) {
            let query = model.find(filter).lean();

            if (options?.sort) {
                query = query.sort(options.sort);
            }
            if (options?.skip) {
                query = query.skip(options.skip);
            }
            if (options?.limit) {
                query = query.limit(options.limit);
            }

            return await query.exec();
        }

        // Fallback to raw collection
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
    }

    /**
     * Find a single document matching a filter.
     *
     * Prefers registered Mongoose model if available (uses .lean() for performance),
     * falls back to raw collection access.
     *
     * @param collectionName - Logical collection name
     * @param filter - MongoDB query filter
     * @returns The first matching document, or null
     */
    public async findOne<T extends Document = Document>(
        collectionName: string,
        filter: Filter<T>
    ): Promise<T | null> {
        // Prefer Mongoose model if registered
        const model = this.models.get(collectionName);
        if (model) {
            return await model.findOne(filter).lean().exec();
        }

        // Fallback to raw collection
        const collection = this.getCollection<T>(collectionName);
        return (await collection.findOne(filter)) as T | null;
    }

    /**
     * Insert a single document into a collection.
     *
     * Prefers registered Mongoose model if available (applies validation and defaults),
     * falls back to raw collection insert.
     *
     * @param collectionName - Logical collection name
     * @param document - Document to insert
     * @returns The inserted document ID
     * @throws Error on duplicate key (code 11000) or validation failure
     */
    public async insertOne<T extends Document = Document>(
        collectionName: string,
        document: T
    ): Promise<any> {
        // Prefer Mongoose model if registered
        const model = this.models.get(collectionName);
        if (model) {
            const result = await model.create(document);
            return result._id;
        }

        // Fallback to raw collection
        const collection = this.getCollection<T>(collectionName);
        const result = await collection.insertOne(document as any);
        return result.insertedId;
    }

    /**
     * Update multiple documents matching a filter.
     *
     * Prefers registered Mongoose model if available, falls back to raw collection.
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
        // Prefer Mongoose model if registered
        const model = this.models.get(collectionName);
        if (model) {
            const result = await model.updateMany(filter, update);
            return result.modifiedCount;
        }

        // Fallback to raw collection
        const collection = this.getCollection<T>(collectionName);
        const result = await collection.updateMany(filter, update);
        return result.modifiedCount;
    }

    /**
     * Delete multiple documents matching a filter.
     *
     * Prefers registered Mongoose model if available, falls back to raw collection.
     *
     * @param collectionName - Logical collection name
     * @param filter - MongoDB query filter
     * @returns Number of documents deleted
     */
    public async deleteMany<T extends Document = Document>(
        collectionName: string,
        filter: Filter<T>
    ): Promise<number> {
        // Prefer Mongoose model if registered
        const model = this.models.get(collectionName);
        if (model) {
            const result = await model.deleteMany(filter);
            return result.deletedCount;
        }

        // Fallback to raw collection
        const collection = this.getCollection<T>(collectionName);
        const result = await collection.deleteMany(filter);
        return result.deletedCount;
    }
}
