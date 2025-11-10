import type { Connection } from 'mongoose';
import type { Collection, Document, Filter, UpdateFilter, IndexDescription, CreateIndexesOptions } from 'mongodb';
import type { IDatabaseService, ISystemLogService } from '@tronrelic/types';
import { MigrationScanner } from '../migration/MigrationScanner.js';
import { MigrationTracker } from '../migration/MigrationTracker.js';
import { MigrationExecutor } from '../migration/MigrationExecutor.js';
import type { IMigrationMetadata } from '../migration/types.js';

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
    private readonly logger: ISystemLogService;
    private readonly connection: Connection;
    private readonly models: Map<string, any> = new Map();

    // Migration system components
    private migrationScanner?: MigrationScanner;
    private migrationTracker?: MigrationTracker;
    private migrationExecutor?: MigrationExecutor;
    private discoveredMigrations: IMigrationMetadata[] = [];
    private pendingMigrations: IMigrationMetadata[] = [];
    private migrationsInitialized = false;

    /**
     * Create a database service instance.
     *
     * Core services typically pass logger, mongoose connection, and optional prefix.
     * Plugins pass a prefix to isolate their collections from other plugins and
     * core services.
     *
     * The Mongoose connection is injected to enable flexible testing strategies:
     * - Unit tests can pass a mocked connection without importing mongoose
     * - Integration tests can pass a real connection to test database
     * - Services declare dependencies explicitly via constructor
     *
     * @param logger - System log service for database operation logging
     * @param mongooseConnection - Mongoose connection instance
     * @param options - Configuration options
     * @param options.prefix - Optional prefix for all collection names
     *
     * @example
     * ```typescript
     * // Core service (called by DatabaseModule)
     * import mongoose from 'mongoose';
     * const db = new DatabaseService(logger, mongoose.connection);
     *
     * // Plugin with namespace isolation
     * const pluginDb = new DatabaseService(logger, mongoose.connection, { prefix: 'plugin_whale-alerts_' });
     * ```
     */
    constructor(logger: ISystemLogService, mongooseConnection: Connection, options?: { prefix?: string }) {
        this.logger = logger;
        this.connection = mongooseConnection;
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
     * **Plugin collection restriction:**
     * If this DatabaseService instance has a collection prefix (plugin databases),
     * it can only access collections with that prefix. Attempting to access
     * non-prefixed collections will throw an error.
     *
     * @param name - Logical collection name
     * @returns MongoDB native collection
     * @throws Error if MongoDB connection not established or plugin tries to access non-prefixed collection
     */
    public getCollection<T extends Document = Document>(name: string): Collection<T> {
        const physicalName = this.getPhysicalCollectionName(name);

        // Plugin collection access restriction
        // If this DatabaseService has a prefix (plugin database), enforce that it can
        // only access collections with that prefix. This prevents plugin migrations
        // from accessing system or other plugin collections.
        if (this.collectionPrefix && !physicalName.startsWith(this.collectionPrefix)) {
            throw new Error(
                `Plugin database cannot access collection '${name}'. ` +
                `Plugins can only access collections with prefix '${this.collectionPrefix}'. ` +
                `Physical collection name '${physicalName}' does not start with required prefix.`
            );
        }

        const db = this.connection.db;
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
        this.logger.debug(
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
            this.logger.error({ error, prefix: this.collectionPrefix, key }, 'Failed to get key from KV store');
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
            this.logger.warn(
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
            this.logger.error({ error, prefix: this.collectionPrefix, key }, 'Failed to delete key from KV store');
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
        indexSpec: Record<string, 1 | -1>,
        options?: { unique?: boolean; sparse?: boolean; expireAfterSeconds?: number; name?: string }
    ): Promise<void> {
        const collection = this.getCollection(collectionName);
        await collection.createIndex(indexSpec as any, options);
        this.logger.info(
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

    /**
     * Initialize the migration system.
     *
     * Discovers migrations from filesystem, builds dependency graph, removes orphaned
     * records, and prepares migration system for execution. Idempotent - subsequent
     * calls are no-ops.
     *
     * @returns Promise that resolves when initialization complete
     */
    public async initializeMigrations(): Promise<void> {
        if (this.migrationsInitialized) {
            this.logger.debug('Migration system already initialized, skipping');
            return;
        }

        this.logger.info('Initializing migration system...');

        try {
            // Initialize migration components
            this.migrationScanner = new MigrationScanner();
            this.migrationTracker = new MigrationTracker(this);
            this.migrationExecutor = new MigrationExecutor(this, this.migrationTracker);

            // Ensure migration tracker indexes exist
            await this.migrationTracker.ensureIndexes();

            // Scan filesystem for migrations
            this.discoveredMigrations = await this.migrationScanner.scan();

            // Remove orphaned pending migrations (code deleted but record exists)
            await this.migrationTracker.removeOrphanedPending(this.discoveredMigrations);

            // Determine which migrations are pending execution
            this.pendingMigrations = await this.migrationTracker.getPendingMigrations(this.discoveredMigrations);

            this.migrationsInitialized = true;

            this.logger.info({
                discovered: this.discoveredMigrations.length,
                pending: this.pendingMigrations.length
            }, 'Migration system initialized');

        } catch (error) {
            this.logger.error({ error }, 'Failed to initialize migration system');
            throw error;
        }
    }

    /**
     * Get list of pending migrations.
     *
     * Returns migrations that have been discovered but not yet executed successfully.
     * Migrations are in topological order (dependencies first).
     *
     * @returns Promise resolving to array of pending migration metadata
     */
    public async getMigrationsPending(): Promise<Array<{
        id: string;
        description: string;
        source: string;
        filePath: string;
        timestamp: Date;
        dependencies: string[];
        checksum?: string;
    }>> {
        if (!this.migrationsInitialized) {
            throw new Error('Migration system not initialized. Call initializeMigrations() first.');
        }

        // Map to exclude the 'up' function for serialization
        return this.pendingMigrations.map(m => ({
            id: m.id,
            description: m.description,
            source: m.source,
            filePath: m.filePath,
            timestamp: m.timestamp,
            dependencies: m.dependencies || [],
            checksum: m.checksum
        }));
    }

    /**
     * Get list of completed migrations from database.
     *
     * @param limit - Maximum records to return (default: 100)
     * @returns Promise resolving to array of migration execution records
     */
    public async getMigrationsCompleted(limit = 100): Promise<Array<{
        migrationId: string;
        status: 'completed' | 'failed';
        source: string;
        executedAt: Date;
        executionDuration: number;
        error?: string;
        errorStack?: string;
        checksum?: string;
        environment?: string;
        codebaseVersion?: string;
    }>> {
        if (!this.migrationTracker) {
            throw new Error('Migration system not initialized. Call initializeMigrations() first.');
        }

        return await this.migrationTracker.getCompletedMigrations(limit);
    }

    /**
     * Execute a specific migration by ID.
     *
     * Validates migration exists and dependencies are met before execution.
     *
     * @param migrationId - Unique ID of migration to execute
     * @returns Promise that resolves when migration completes successfully
     * @throws Error if migration not found, dependencies unmet, or execution fails
     */
    public async executeMigration(migrationId: string): Promise<void> {
        if (!this.migrationExecutor) {
            throw new Error('Migration system not initialized. Call initializeMigrations() first.');
        }

        // Find the migration in discovered migrations
        const migration = this.discoveredMigrations.find(m => m.id === migrationId);

        if (!migration) {
            throw new Error(
                `Migration '${migrationId}' not found. ` +
                `Available migrations: ${this.discoveredMigrations.map(m => m.id).join(', ')}`
            );
        }

        // Validate dependencies are met
        const completedIds = await this.migrationTracker!.getCompletedMigrationIds();
        const completedSet = new Set(completedIds);

        for (const depId of migration.dependencies || []) {
            if (!completedSet.has(depId)) {
                throw new Error(
                    `Cannot execute migration '${migrationId}': ` +
                    `dependency '${depId}' has not been executed yet.`
                );
            }
        }

        // Execute the migration
        await this.migrationExecutor.executeMigration(migration);

        // Update pending migrations list after successful execution
        this.pendingMigrations = await this.migrationTracker!.getPendingMigrations(this.discoveredMigrations);
    }

    /**
     * Execute all pending migrations in dependency order.
     *
     * Executes migrations serially, stopping on first failure.
     *
     * @returns Promise that resolves when all migrations complete successfully
     * @throws Error if any migration fails
     */
    public async executeMigrationsAll(): Promise<void> {
        if (!this.migrationExecutor) {
            throw new Error('Migration system not initialized. Call initializeMigrations() first.');
        }

        if (this.pendingMigrations.length === 0) {
            this.logger.info('No pending migrations to execute');
            return;
        }

        this.logger.info({ count: this.pendingMigrations.length }, 'Executing all pending migrations...');

        await this.migrationExecutor.executeMigrations(this.pendingMigrations);

        // Update pending migrations list after successful execution
        this.pendingMigrations = await this.migrationTracker!.getPendingMigrations(this.discoveredMigrations);

        this.logger.info('All pending migrations executed successfully');
    }

    /**
     * Check if a migration is currently executing.
     *
     * @returns True if a migration is running
     */
    public isMigrationRunning(): boolean {
        if (!this.migrationExecutor) {
            return false;
        }

        return this.migrationExecutor.isRunning();
    }
}
