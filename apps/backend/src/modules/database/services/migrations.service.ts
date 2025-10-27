import type { IDatabaseService, ISystemLogService } from '@tronrelic/types';
import type { IMigrationStatus, IMigrationExecutionResult } from '../migration/types.js';

/**
 * Service providing business logic for migration management.
 *
 * Wraps the DatabaseService migration methods with additional validation,
 * error handling, and logging appropriate for API endpoints. Provides a
 * clean interface for the migrations controller.
 *
 * Why this exists:
 * - Separates business logic from HTTP request handling
 * - Provides consistent error messages for API responses
 * - Adds additional validation beyond DatabaseService
 * - Centralizes migration logging
 *
 * @example
 * ```typescript
 * const service = new MigrationsService(database);
 *
 * // Get migration status
 * const status = await service.getStatus();
 * console.log(`${status.totalPending} migrations pending`);
 *
 * // Execute all pending migrations
 * const result = await service.executeAll();
 * if (result.success) {
 *     console.log(`Executed ${result.executed.length} migrations`);
 * }
 * ```
 */
export class MigrationsService {
    private readonly database: IDatabaseService;
    private readonly logger: ISystemLogService;

    /**
     * Create a new migrations service.
     *
     * @param database - Database service with migration methods
     * @param logger - System log service for migration operation logging
     */
    constructor(database: IDatabaseService, logger: ISystemLogService) {
        this.database = database;
        this.logger = logger;
    }

    /**
     * Get comprehensive migration status.
     *
     * Returns current state of migration system including pending migrations,
     * execution history, and running status.
     *
     * @returns Promise resolving to migration status
     * @throws Error if migration system not initialized
     */
    public async getStatus(): Promise<IMigrationStatus> {
        try {
            const pending = await this.database.getMigrationsPending();
            const completed = await this.database.getMigrationsCompleted();
            const isRunning = this.database.isMigrationRunning();

            return {
                pending,
                completed,
                isRunning,
                totalPending: pending.length,
                totalCompleted: completed.length
            };
        } catch (error: any) {
            this.logger.error({ error }, 'Failed to get migration status');
            throw new Error(`Failed to get migration status: ${error.message}`);
        }
    }

    /**
     * Get execution history with optional filtering.
     *
     * Returns migration execution records sorted by time (newest first).
     *
     * @param limit - Maximum records to return (default: 100, max: 500)
     * @param status - Filter by status ('completed', 'failed', or 'all')
     * @returns Promise resolving to filtered execution records
     */
    public async getHistory(limit = 100, status: 'completed' | 'failed' | 'all' = 'all') {
        try {
            // Enforce maximum limit
            const effectiveLimit = Math.min(limit, 500);

            const allRecords = await this.database.getMigrationsCompleted(effectiveLimit);

            // Apply status filter
            if (status === 'all') {
                return allRecords;
            }

            return allRecords.filter(record => record.status === status);
        } catch (error: any) {
            this.logger.error({ error, limit, status }, 'Failed to get migration history');
            throw new Error(`Failed to get migration history: ${error.message}`);
        }
    }

    /**
     * Execute a specific migration by ID.
     *
     * Validates that no migration is currently running before executing.
     *
     * @param migrationId - Unique ID of migration to execute
     * @returns Promise resolving to execution result
     * @throws Error if migration already running, not found, or execution fails
     */
    public async executeOne(migrationId: string): Promise<IMigrationExecutionResult> {
        // Check if another migration is running
        if (this.database.isMigrationRunning()) {
            throw new Error('Cannot execute migration: Another migration is already running');
        }

        this.logger.info({ migrationId }, 'Executing single migration via API');

        try {
            await this.database.executeMigration(migrationId);

            this.logger.info({ migrationId }, 'Migration executed successfully via API');

            return {
                success: true,
                executed: [migrationId]
            };
        } catch (error: any) {
            this.logger.error({ migrationId, error }, 'Migration execution failed via API');

            return {
                success: false,
                executed: [],
                failed: {
                    migrationId,
                    error: error.message
                }
            };
        }
    }

    /**
     * Execute all pending migrations in dependency order.
     *
     * Validates that no migration is currently running before executing.
     * Stops on first failure.
     *
     * @returns Promise resolving to execution result
     * @throws Error if migration already running
     */
    public async executeAll(): Promise<IMigrationExecutionResult> {
        // Check if another migration is running
        if (this.database.isMigrationRunning()) {
            throw new Error('Cannot execute migrations: Another migration is already running');
        }

        const pending = await this.database.getMigrationsPending();

        if (pending.length === 0) {
            this.logger.info('No pending migrations to execute via API');
            return {
                success: true,
                executed: []
            };
        }

        this.logger.info({ count: pending.length }, 'Executing all pending migrations via API');

        const executed: string[] = [];

        try {
            // Execute all pending migrations
            await this.database.executeMigrationsAll();

            // All succeeded - collect IDs
            for (const migration of pending) {
                executed.push(migration.id);
            }

            this.logger.info({ count: executed.length }, 'All migrations executed successfully via API');

            return {
                success: true,
                executed
            };
        } catch (error: any) {
            // At least one migration failed
            // Get updated pending to determine which migrations actually executed
            const stillPending = await this.database.getMigrationsPending();
            const stillPendingIds = new Set(stillPending.map(m => m.id));

            // Migrations that are no longer pending were executed
            for (const migration of pending) {
                if (!stillPendingIds.has(migration.id)) {
                    executed.push(migration.id);
                }
            }

            // The migration that failed is the first one in stillPending
            const failedMigration = stillPending[0];

            this.logger.error({
                executed: executed.length,
                failed: failedMigration?.id,
                error
            }, 'Migration batch execution failed via API');

            return {
                success: false,
                executed,
                failed: {
                    migrationId: failedMigration?.id || 'unknown',
                    error: error.message
                }
            };
        }
    }

    /**
     * Get detailed information about a specific migration.
     *
     * Returns metadata and execution history for a single migration.
     *
     * @param migrationId - Unique ID of migration
     * @returns Promise resolving to migration details
     * @throws Error if migration not found
     */
    public async getMigrationDetails(migrationId: string) {
        try {
            const pending = await this.database.getMigrationsPending();
            const completed = await this.database.getMigrationsCompleted(500);

            // Check if migration is pending
            const pendingMigration = pending.find(m => m.id === migrationId);
            if (pendingMigration) {
                return {
                    migration: pendingMigration,
                    isPending: true,
                    executions: completed.filter(r => r.migrationId === migrationId)
                };
            }

            // Check execution history
            const executions = completed.filter(r => r.migrationId === migrationId);
            if (executions.length > 0) {
                return {
                    migration: null,
                    isPending: false,
                    executions
                };
            }

            throw new Error(`Migration '${migrationId}' not found`);
        } catch (error: any) {
            this.logger.error({ migrationId, error }, 'Failed to get migration details');
            throw new Error(`Failed to get migration details: ${error.message}`);
        }
    }
}
