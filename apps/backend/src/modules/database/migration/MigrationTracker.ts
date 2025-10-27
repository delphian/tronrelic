import type { IDatabaseService } from '@tronrelic/types';
import type { Collection } from 'mongodb';
import type { IMigrationMetadata, IMigrationRecord } from './types.js';
import { logger } from '../../../lib/logger.js';
import { execSync } from 'child_process';

/**
 * Migration execution tracker using MongoDB for persistent state.
 *
 * Manages the `migrations` collection which serves as the source of truth for which
 * migrations have executed. Provides methods to query completed migrations, record
 * successes/failures, and handle orphaned migration cleanup.
 *
 * **Collection schema:** See `IMigrationRecord` interface for complete structure.
 *
 * **Indexes:**
 * - `{ migrationId: 1 }` - Unique, for fast status lookups
 * - `{ executedAt: -1 }` - For chronological history queries
 * - `{ status: 1, executedAt: -1 }` - For admin UI filtering
 *
 * Why this exists:
 * - Prevents re-execution of completed migrations
 * - Tracks failures for debugging
 * - Provides audit trail of schema changes
 * - Enables migration status API endpoints
 *
 * @example
 * ```typescript
 * const tracker = new MigrationTracker(databaseService);
 *
 * // Get migrations that haven't executed yet
 * const pending = await tracker.getPendingMigrations(discovered);
 *
 * // Record successful execution
 * await tracker.recordSuccess(metadata, 1543);
 *
 * // Query execution history
 * const completed = await tracker.getCompletedMigrations();
 * ```
 */
export class MigrationTracker {
    private readonly database: IDatabaseService;
    private readonly collectionName = 'migrations';

    /**
     * Create a new migration tracker.
     *
     * @param database - Database service for accessing migrations collection
     */
    constructor(database: IDatabaseService) {
        this.database = database;
    }

    /**
     * Get MongoDB collection for migration records.
     *
     * Uses raw collection access (not Mongoose model) for maximum flexibility.
     * Collection is automatically created on first write if it doesn't exist.
     *
     * @returns MongoDB native collection for migrations
     */
    private getCollection(): Collection<IMigrationRecord> {
        return this.database.getCollection<IMigrationRecord>(this.collectionName);
    }

    /**
     * Ensure required indexes exist on migrations collection.
     *
     * Creates indexes for:
     * - Unique migration ID lookup (prevents duplicate executions)
     * - Chronological history queries (executedAt descending)
     * - Admin UI filtering (status + executedAt)
     *
     * This method is idempotent and can be called multiple times safely.
     * MongoDB will skip index creation if indexes already exist.
     *
     * Should be called during system initialization before any migration operations.
     *
     * @returns Promise that resolves when indexes are created
     */
    public async ensureIndexes(): Promise<void> {
        try {
            // Unique index on migrationId prevents duplicate execution records
            await this.database.createIndex(
                this.collectionName,
                { migrationId: 1 },
                { unique: true }
            );

            // Index for chronological history queries
            await this.database.createIndex(
                this.collectionName,
                { executedAt: -1 }
            );

            // Compound index for admin UI filtering (status + time)
            await this.database.createIndex(
                this.collectionName,
                { status: 1, executedAt: -1 }
            );

            logger.debug('Migration tracker indexes ensured');
        } catch (error) {
            logger.error({ error }, 'Failed to ensure migration tracker indexes');
            throw error;
        }
    }

    /**
     * Get IDs of all completed migrations.
     *
     * Returns migration IDs for all records with status='completed'. Does not
     * include failed migrations (allowing them to be retried).
     *
     * Used to filter discovered migrations and determine which are pending execution.
     *
     * @returns Promise resolving to array of completed migration IDs
     *
     * @example
     * ```typescript
     * const completedIds = await tracker.getCompletedMigrationIds();
     * // ['001_create_users', '002_create_roles', '003_add_indexes']
     * ```
     */
    public async getCompletedMigrationIds(): Promise<string[]> {
        const collection = this.getCollection();
        const records = await collection.find(
            { status: 'completed' },
            { projection: { migrationId: 1 } }
        ).toArray();

        return records.map(r => r.migrationId);
    }

    /**
     * Get all completed and failed migration records.
     *
     * Returns full migration records sorted by execution time (newest first).
     * Includes both successful and failed executions for complete audit trail.
     *
     * Used by admin UI to display migration history.
     *
     * @param limit - Maximum number of records to return (default: 100)
     * @returns Promise resolving to array of migration records
     *
     * @example
     * ```typescript
     * const history = await tracker.getCompletedMigrations(50);
     * history.forEach(record => {
     *     console.log(`${record.migrationId}: ${record.status} (${record.executionDuration}ms)`);
     * });
     * ```
     */
    public async getCompletedMigrations(limit = 100): Promise<IMigrationRecord[]> {
        const collection = this.getCollection();
        const records = await collection.find({})
            .sort({ executedAt: -1 })
            .limit(limit)
            .toArray();

        return records;
    }

    /**
     * Determine which discovered migrations are pending execution.
     *
     * Compares discovered migrations against completed migration IDs and returns
     * migrations that haven't executed successfully yet. Failed migrations are
     * included as pending (allowing retry).
     *
     * **Logic:**
     * 1. Get list of completed migration IDs
     * 2. Filter discovered migrations to exclude completed IDs
     * 3. Return remaining migrations (pending execution)
     *
     * @param discovered - All migrations found during filesystem scan
     * @returns Promise resolving to array of pending migration metadata
     *
     * @example
     * ```typescript
     * const discovered = await scanner.scan();
     * const pending = await tracker.getPendingMigrations(discovered);
     *
     * if (pending.length === 0) {
     *     console.log('No migrations pending');
     * } else {
     *     console.log(`${pending.length} migrations pending execution`);
     * }
     * ```
     */
    public async getPendingMigrations(discovered: IMigrationMetadata[]): Promise<IMigrationMetadata[]> {
        const completedIds = await this.getCompletedMigrationIds();
        const completedSet = new Set(completedIds);

        return discovered.filter(m => !completedSet.has(m.qualifiedId));
    }

    /**
     * Record successful migration execution.
     *
     * Creates a record in the migrations collection marking the migration as completed.
     * Includes execution metadata (duration, checksum, environment, codebase version).
     *
     * **Fields recorded:**
     * - migrationId, status='completed', source
     * - executedAt (current timestamp), executionDuration
     * - checksum (for detecting post-execution modifications)
     * - environment (NODE_ENV), codebaseVersion (git commit hash if available)
     *
     * @param metadata - Migration metadata from scanner
     * @param duration - Execution duration in milliseconds
     * @returns Promise that resolves when record is saved
     * @throws Error if insert fails (e.g., duplicate migrationId)
     *
     * @example
     * ```typescript
     * const startTime = Date.now();
     * await migration.up(database);
     * const duration = Date.now() - startTime;
     * await tracker.recordSuccess(metadata, duration);
     * ```
     */
    public async recordSuccess(metadata: IMigrationMetadata, duration: number): Promise<void> {
        const collection = this.getCollection();

        const record: IMigrationRecord = {
            migrationId: metadata.qualifiedId,
            status: 'completed',
            source: metadata.source,
            executedAt: new Date(),
            executionDuration: duration,
            checksum: metadata.checksum,
            environment: process.env.NODE_ENV,
            codebaseVersion: this.getGitCommitHash()
        };

        try {
            await collection.insertOne(record as any);
            logger.info({
                migrationId: metadata.qualifiedId,
                duration,
                source: metadata.source
            }, 'Migration execution recorded as successful');
        } catch (error) {
            logger.error({ error, migrationId: metadata.qualifiedId }, 'Failed to record migration success');
            throw error;
        }
    }

    /**
     * Record failed migration execution.
     *
     * Creates a record in the migrations collection marking the migration as failed.
     * Includes error details (message and stack trace) for debugging.
     *
     * **Fields recorded:**
     * - All fields from recordSuccess()
     * - status='failed'
     * - error (error message)
     * - errorStack (full stack trace)
     *
     * Failed migrations can be retried (they remain in pending state until successful).
     *
     * @param metadata - Migration metadata from scanner
     * @param error - Error thrown by migration.up()
     * @param duration - Execution duration in milliseconds (time until failure)
     * @returns Promise that resolves when record is saved
     * @throws Error if insert fails
     *
     * @example
     * ```typescript
     * try {
     *     await migration.up(database);
     * } catch (error) {
     *     await tracker.recordFailure(metadata, error, duration);
     *     throw error;
     * }
     * ```
     */
    public async recordFailure(metadata: IMigrationMetadata, error: Error, duration: number): Promise<void> {
        const collection = this.getCollection();

        const record: IMigrationRecord = {
            migrationId: metadata.qualifiedId,
            status: 'failed',
            source: metadata.source,
            executedAt: new Date(),
            executionDuration: duration,
            error: error.message,
            errorStack: error.stack,
            checksum: metadata.checksum,
            environment: process.env.NODE_ENV,
            codebaseVersion: this.getGitCommitHash()
        };

        try {
            await collection.insertOne(record as any);
            logger.error({
                migrationId: metadata.qualifiedId,
                error: error.message,
                duration,
                source: metadata.source
            }, 'Migration execution recorded as failed');
        } catch (insertError) {
            logger.error({ error: insertError, migrationId: metadata.qualifiedId }, 'Failed to record migration failure');
            throw insertError;
        }
    }

    /**
     * Remove pending migrations for deleted code.
     *
     * Compares discovered migrations against database records. If a migration
     * has a database record but is not discovered (code deleted), removes the
     * record if it's not completed.
     *
     * **Rules:**
     * - Completed migrations: Keep record (history preservation)
     * - Failed migrations for missing code: Remove record
     * - No-op if no orphaned migrations found
     *
     * Should be called during system initialization after filesystem scan completes.
     *
     * @param discovered - All migrations found during filesystem scan
     * @returns Promise resolving to count of orphaned records removed
     *
     * @example
     * ```typescript
     * const discovered = await scanner.scan();
     * const removed = await tracker.removeOrphanedPending(discovered);
     * if (removed > 0) {
     *     console.log(`Removed ${removed} orphaned migration records`);
     * }
     * ```
     */
    public async removeOrphanedPending(discovered: IMigrationMetadata[]): Promise<number> {
        const collection = this.getCollection();

        // Build set of discovered migration qualified IDs
        const discoveredIds = new Set(discovered.map(m => m.qualifiedId));

        // Find all records in database
        const allRecords = await collection.find({}).toArray();

        // Identify orphaned records (in database but not discovered, and not completed)
        const orphaned = allRecords.filter(record =>
            !discoveredIds.has(record.migrationId) && record.status !== 'completed'
        );

        if (orphaned.length === 0) {
            return 0;
        }

        // Delete orphaned records
        const orphanedIds = orphaned.map(r => r.migrationId);
        const result = await collection.deleteMany({
            migrationId: { $in: orphanedIds }
        });

        logger.info({
            count: result.deletedCount,
            migrationIds: orphanedIds
        }, 'Removed orphaned pending migration records (code deleted)');

        return result.deletedCount || 0;
    }

    /**
     * Attempt to get current git commit hash.
     *
     * Executes `git rev-parse HEAD` to get commit hash. Returns undefined if:
     * - Not in a git repository
     * - git command not available
     * - Command fails for any reason
     *
     * This is best-effort only and should not affect migration execution if unavailable.
     *
     * @returns Git commit hash or undefined if unavailable
     */
    private getGitCommitHash(): string | undefined {
        try {
            const hash = execSync('git rev-parse HEAD', {
                encoding: 'utf-8',
                stdio: ['ignore', 'pipe', 'ignore'],
                timeout: 1000 // 1 second timeout
            }).trim();

            return hash || undefined;
        } catch (error) {
            // Git not available or not in repository - not an error
            return undefined;
        }
    }
}
