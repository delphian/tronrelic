import mongoose from 'mongoose';
import type { IDatabaseService, IClickHouseService, IMigrationContext } from '@tronrelic/types';
import type { IMigrationMetadata } from './types.js';
import { MigrationTracker } from './MigrationTracker.js';
import { logger } from '../../../lib/logger.js';

/**
 * Executor for running database migrations with transaction support.
 *
 * Handles the execution of individual migrations or batches of migrations with:
 * - MongoDB transaction wrapping (when supported by deployment)
 * - Execution timing
 * - Success/failure recording
 * - Transaction rollback on failure
 * - Application crash if rollback fails (prevents data corruption)
 * - Serial execution enforcement (no concurrency)
 *
 * **Transaction behavior:**
 * MongoDB transactions require:
 * - Replica set deployment (not standalone MongoDB)
 * - MongoDB 4.0+ with WiredTiger storage engine
 *
 * If transactions are not supported, migrations run without transaction protection
 * and a warning is logged.
 *
 * **Rollback failure handling:**
 * If a migration fails AND transaction rollback fails, the application will CRASH
 * with process.exit(1). This prevents the application from continuing with potentially
 * corrupted data. Operators must manually investigate and recover the database state.
 *
 * @example
 * ```typescript
 * const executor = new MigrationExecutor(database, tracker);
 *
 * // Execute single migration
 * await executor.executeMigration(migrationMetadata);
 *
 * // Execute multiple migrations in order
 * await executor.executeMigrations([migration1, migration2, migration3]);
 *
 * // Check if any migration is currently running
 * if (!executor.isRunning()) {
 *     await executor.executeMigrations(pending);
 * }
 * ```
 */
export class MigrationExecutor {
    private readonly database: IDatabaseService;
    private readonly clickhouse?: IClickHouseService;
    private readonly tracker: MigrationTracker;
    private isExecuting = false;

    /**
     * Create a new migration executor.
     *
     * @param database - Database service for MongoDB migrations
     * @param tracker - Migration tracker for recording execution results
     * @param clickhouse - Optional ClickHouse service for ClickHouse migrations
     */
    constructor(
        database: IDatabaseService,
        tracker: MigrationTracker,
        clickhouse?: IClickHouseService
    ) {
        this.database = database;
        this.tracker = tracker;
        this.clickhouse = clickhouse;
    }

    /**
     * Build the migration context for executing migrations.
     *
     * @returns IMigrationContext with database and optionally ClickHouse
     */
    private buildMigrationContext(): IMigrationContext {
        return {
            database: this.database,
            clickhouse: this.clickhouse
        };
    }

    /**
     * Check if a migration can be executed based on its target.
     *
     * ClickHouse migrations are skipped if ClickHouse is not configured.
     *
     * @param migration - Migration to check
     * @returns Object with canExecute flag and optional skip reason
     */
    private checkMigrationTarget(migration: IMigrationMetadata): { canExecute: boolean; skipReason?: string } {
        const target = migration.target || 'mongodb';

        if (target === 'clickhouse' && !this.clickhouse) {
            return {
                canExecute: false,
                skipReason: 'ClickHouse not configured (CLICKHOUSE_HOST not set)'
            };
        }

        return { canExecute: true };
    }

    /**
     * Check if a migration is currently executing.
     *
     * Used to enforce serial execution (no concurrent migrations) and provide
     * status feedback to admin UI.
     *
     * @returns True if a migration is currently running
     *
     * @example
     * ```typescript
     * if (executor.isRunning()) {
     *     throw new Error('Cannot execute migration: Another migration is already running');
     * }
     * ```
     */
    public isRunning(): boolean {
        return this.isExecuting;
    }

    /**
     * Execute a single migration with transaction support.
     *
     * Wraps migration execution in a MongoDB transaction (if supported), measures
     * duration, records success/failure, and handles rollback.
     *
     * **Execution flow:**
     * 1. Check if already executing (enforce serial execution)
     * 2. Set execution flag
     * 3. Start MongoDB session (if transactions supported)
     * 4. Start transaction
     * 5. Execute migration.up(database)
     * 6. Commit transaction
     * 7. Record success in tracker
     * 8. On error:
     *    a. Attempt transaction rollback
     *    b. Record failure in tracker
     *    c. If rollback fails, CRASH application
     * 9. Clear execution flag
     *
     * **Transaction support detection:**
     * Checks if MongoDB connection is to a replica set. If not, logs warning
     * and executes without transaction.
     *
     * @param migration - Migration metadata to execute
     * @returns Promise that resolves when migration completes successfully
     * @throws Error if migration fails or another migration is already running
     *
     * @example
     * ```typescript
     * try {
     *     await executor.executeMigration(metadata);
     *     console.log('Migration succeeded');
     * } catch (error) {
     *     console.error('Migration failed:', error.message);
     *     // Migration is marked as failed in tracker, can be retried
     * }
     * ```
     */
    public async executeMigration(migration: IMigrationMetadata): Promise<void> {
        if (this.isExecuting) {
            throw new Error('Cannot execute migration: Another migration is already running');
        }

        // Check if migration can be executed based on target
        const targetCheck = this.checkMigrationTarget(migration);
        if (!targetCheck.canExecute) {
            logger.warn({
                migrationId: migration.id,
                target: migration.target || 'mongodb',
                reason: targetCheck.skipReason
            }, 'Skipping migration (target not available)');
            return;
        }

        this.isExecuting = true;

        try {
            await this.executeWithTransaction(migration);
        } finally {
            this.isExecuting = false;
        }
    }

    /**
     * Execute multiple migrations in series.
     *
     * Executes migrations one at a time in the provided order. Stops on first failure.
     *
     * **Important:** Migrations should already be sorted in topological order (dependencies first).
     * This method does NOT validate dependencies - it assumes correct ordering.
     *
     * @param migrations - Array of migrations to execute in order
     * @returns Promise that resolves when all migrations complete successfully
     * @throws Error if any migration fails (remaining migrations are skipped)
     *
     * @example
     * ```typescript
     * const pending = await tracker.getPendingMigrations(discovered);
     *
     * try {
     *     await executor.executeMigrations(pending);
     *     console.log('All migrations completed successfully');
     * } catch (error) {
     *     console.error('Migration batch failed:', error.message);
     *     // Check tracker for which migration failed
     * }
     * ```
     */
    public async executeMigrations(migrations: IMigrationMetadata[]): Promise<void> {
        if (migrations.length === 0) {
            logger.info('No migrations to execute');
            return;
        }

        logger.info({ count: migrations.length }, 'Executing migration batch');

        for (const migration of migrations) {
            await this.executeMigration(migration);
        }

        logger.info({ count: migrations.length }, 'Migration batch completed successfully');
    }

    /**
     * Execute a migration with MongoDB transaction support.
     *
     * Wraps migration in transaction if supported, otherwise executes directly.
     * Handles rollback on failure and crashes application if rollback fails.
     *
     * @param migration - Migration to execute
     * @returns Promise that resolves on success
     * @throws Error if migration fails
     */
    private async executeWithTransaction(migration: IMigrationMetadata): Promise<void> {
        const startTime = Date.now();
        const supportsTransactions = this.checkTransactionSupport();

        if (!supportsTransactions) {
            logger.warn({
                migrationId: migration.id
            }, 'MongoDB transactions not supported (not a replica set). Migration will execute without transaction protection.');
        }

        logger.info({
            migrationId: migration.id,
            source: migration.source,
            description: migration.description,
            dependencies: migration.dependencies
        }, 'Executing migration...');

        // Execute with or without transaction based on support
        if (supportsTransactions) {
            await this.executeWithTransactionSupport(migration, startTime);
        } else {
            await this.executeWithoutTransaction(migration, startTime);
        }
    }

    /**
     * Execute migration with MongoDB transaction support.
     *
     * Uses mongoose session and transaction for atomic operation.
     * On failure, attempts rollback and crashes if rollback fails.
     *
     * @param migration - Migration to execute
     * @param startTime - Execution start timestamp
     * @returns Promise that resolves on success
     * @throws Error if migration fails
     */
    private async executeWithTransactionSupport(migration: IMigrationMetadata, startTime: number): Promise<void> {
        const session = await mongoose.startSession();
        const context = this.buildMigrationContext();

        try {
            await session.withTransaction(async () => {
                // Execute the migration with context
                await migration.up(context);
            });

            // Transaction committed successfully
            const duration = Date.now() - startTime;
            await this.tracker.recordSuccess(migration, duration);

            logger.info({
                migrationId: migration.id,
                duration,
                source: migration.source
            }, 'Migration executed successfully');

        } catch (error: any) {
            const duration = Date.now() - startTime;

            // Transaction automatically rolled back by withTransaction()
            logger.error({
                migrationId: migration.id,
                error: error.message,
                duration
            }, 'Migration failed, transaction rolled back');

            // Record failure in tracker
            try {
                await this.tracker.recordFailure(migration, error, duration);
            } catch (recordError: any) {
                // Failed to record failure - this is serious but not fatal to the app
                logger.error({
                    migrationId: migration.id,
                    originalError: error.message,
                    recordError: recordError.message
                }, 'Failed to record migration failure in tracker');
            }

            throw error;

        } finally {
            await session.endSession();
        }
    }

    /**
     * Execute migration without transaction support.
     *
     * Runs migration directly without transaction wrapper. On failure, data may
     * be partially modified (no rollback possible).
     *
     * @param migration - Migration to execute
     * @param startTime - Execution start timestamp
     * @returns Promise that resolves on success
     * @throws Error if migration fails
     */
    private async executeWithoutTransaction(migration: IMigrationMetadata, startTime: number): Promise<void> {
        const context = this.buildMigrationContext();

        try {
            // Execute the migration with context (no transaction protection)
            await migration.up(context);

            const duration = Date.now() - startTime;
            await this.tracker.recordSuccess(migration, duration);

            logger.info({
                migrationId: migration.id,
                duration,
                source: migration.source
            }, 'Migration executed successfully (no transaction)');

        } catch (error: any) {
            const duration = Date.now() - startTime;

            logger.error({
                migrationId: migration.id,
                error: error.message,
                duration
            }, 'Migration failed (no transaction, data may be partially modified)');

            // Record failure in tracker
            try {
                await this.tracker.recordFailure(migration, error, duration);
            } catch (recordError: any) {
                // Failed to record failure - log but don't crash
                logger.error({
                    migrationId: migration.id,
                    originalError: error.message,
                    recordError: recordError.message
                }, 'Failed to record migration failure in tracker');
            }

            // Since we can't roll back, we crash the application to prevent further damage
            logger.fatal({
                migrationId: migration.id,
                error: error.message
            }, 'MIGRATION FAILED WITHOUT TRANSACTION SUPPORT - APPLICATION CANNOT CONTINUE SAFELY');

            process.exit(1);
        }
    }

    /**
     * Check if MongoDB deployment supports transactions.
     *
     * Transactions require:
     * - Replica set deployment (not standalone)
     * - MongoDB 4.0+
     * - WiredTiger storage engine
     *
     * Returns false if:
     * - Connection not established
     * - Not a replica set
     * - Any error checking topology
     *
     * @returns True if transactions are supported
     */
    private checkTransactionSupport(): boolean {
        try {
            // Check if connection is established
            if (mongoose.connection.readyState !== 1) {
                return false;
            }

            // Check if deployment is a replica set
            // mongoose.connection.db.admin() provides topology information
            const topology = (mongoose.connection as any).topology;

            if (!topology) {
                return false;
            }

            // Check if topology description indicates replica set
            const description = topology.description;
            if (!description) {
                return false;
            }

            // Replica set types that support transactions
            const supportsTransactions = description.type === 'ReplicaSetWithPrimary' ||
                                         description.type === 'ReplicaSetNoPrimary' ||
                                         description.type === 'Sharded';

            return supportsTransactions;

        } catch (error) {
            logger.debug({ error }, 'Error checking transaction support, assuming not supported');
            return false;
        }
    }
}
