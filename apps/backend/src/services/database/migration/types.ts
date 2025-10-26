import type { IMigration } from '@tronrelic/types';
import type { ObjectId } from 'mongodb';

/**
 * Migration metadata discovered from filesystem.
 *
 * Extends the basic IMigration interface with discovery metadata used for
 * tracking, sorting, and debugging migrations. This information is collected
 * during filesystem scanning and used throughout the migration lifecycle.
 *
 * Why this exists:
 * The IMigration interface defines the contract for migration authors, but the
 * migration system needs additional context about where migrations come from,
 * when they were created, and how to uniquely identify them across restarts.
 */
export interface IMigrationMetadata extends IMigration {
    /**
     * Source location category of the migration.
     *
     * Identifies which part of the codebase owns this migration:
     * - `'system'` - Core system migrations in `apps/backend/src/services/database/migrations/`
     * - `'module:{name}'` - Module-specific migrations in `apps/backend/src/modules/{name}/migrations/`
     * - `'plugin:{id}'` - Plugin-specific migrations in `packages/plugins/{id}/src/backend/migrations/`
     *
     * Used for:
     * - Admin UI filtering and grouping
     * - Access control (plugins restricted to prefixed collections)
     * - Orphan detection (identify migrations from deleted plugins)
     *
     * @example
     * 'system'
     * 'module:menu'
     * 'plugin:whale-alerts'
     */
    source: string;

    /**
     * Fully qualified migration ID including source namespace.
     *
     * This is the globally unique identifier used for dependency resolution,
     * database tracking, and preventing ID collisions across different sources.
     *
     * Format:
     * - System migrations: Plain ID (no prefix) - `'001_create_users'`
     * - Module migrations: `'module:{name}:{id}'` - `'module:menu:001_add_namespace'`
     * - Plugin migrations: `'plugin:{id}:{migration-id}'` - `'plugin:whale-alerts:001_create_subscriptions'`
     *
     * Why this matters:
     * The scanner builds a lookup map keyed by `qualifiedId`. When validating dependencies,
     * it looks them up in this map. System migrations can be referenced with plain IDs because
     * their `qualifiedId` IS the plain ID. Module/plugin migrations require qualified IDs in
     * the dependencies array because their `qualifiedId` includes the source prefix.
     *
     * Prevents collisions when multiple sources use the same numeric prefix.
     * For example, `plugin:whale-alerts:001_init` and `plugin:markets:001_init`
     * are distinct migrations even though both use `001_init` as their base ID.
     *
     * @example
     * '001_create_users'                          // System migration
     * 'module:menu:001_add_namespace'              // Module migration
     * 'plugin:whale-alerts:001_create_subscriptions' // Plugin migration
     */
    qualifiedId: string;

    /**
     * Absolute filesystem path to the migration file.
     *
     * Used for:
     * - Debugging (log which file executed)
     * - Error reporting (show file location in admin UI)
     * - Hot reloading (watch file for changes in development)
     *
     * @example
     * '/home/user/tronrelic/apps/backend/src/services/database/migrations/001_create_users.ts'
     */
    filePath: string;

    /**
     * File modification timestamp from filesystem.
     *
     * Extracted from `fileStats.mtime` during migration scanning. This reflects
     * when the migration file was last modified, not when it was created.
     *
     * Used for:
     * - Sorting migrations chronologically (when using 'timestamp' sort strategy)
     * - Admin UI display (show last modified date)
     * - History tracking
     *
     * Note: In cloned repositories or Docker builds, this may not reflect the
     * original creation time. Use numeric ID prefixes (001, 002, 003) for
     * reliable ordering instead.
     *
     * @example
     * new Date('2025-01-15T10:30:00Z')
     */
    timestamp: Date;

    /**
     * SHA-256 checksum of the migration file contents.
     *
     * Calculated from the raw file buffer to detect modifications after execution.
     * Stored in both metadata and execution records for comparison.
     *
     * Why this matters:
     * - Detects if a completed migration was modified (warning, not error)
     * - Helps diagnose unexpected behavior after code changes
     * - Provides audit trail for migration tampering
     *
     * Format: Hexadecimal string (64 characters)
     *
     * @example
     * 'a3b5c7d9e1f2g3h4i5j6k7l8m9n0o1p2q3r4s5t6u7v8w9x0y1z2a3b4c5d6e7f8g9h0'
     */
    checksum?: string;
}

/**
 * Migration execution record stored in MongoDB `migrations` collection.
 *
 * Tracks the execution history of each migration, including success/failure status,
 * timing, errors, and environment metadata. This collection provides the source of
 * truth for which migrations have executed and their outcomes.
 *
 * **Collection name:** `migrations`
 *
 * **Indexes:**
 * - `{ migrationId: 1 }` - Unique, for fast lookup of execution status
 * - `{ executedAt: -1 }` - For chronological history queries
 * - `{ status: 1, executedAt: -1 }` - For admin UI filtering
 *
 * Why this exists:
 * - Prevents re-execution of completed migrations
 * - Tracks failed migrations for manual investigation
 * - Provides audit trail of all database schema changes
 * - Stores context for debugging production issues
 */
export interface IMigrationRecord {
    /**
     * MongoDB ObjectId for the record.
     *
     * Auto-generated by MongoDB on insert. Used for internal record management
     * but not exposed in most APIs (migrationId is the primary identifier).
     */
    _id?: ObjectId;

    /**
     * Unique migration identifier matching IMigration.id.
     *
     * Links execution records to migration code. Must be globally unique across
     * all sources (system, modules, plugins).
     *
     * @example
     * '001_create_users'
     * 'whale-alerts:002_create_subscriptions'
     */
    migrationId: string;

    /**
     * Execution status of the migration.
     *
     * - `'completed'` - Migration executed successfully and transaction committed
     * - `'failed'` - Migration threw error and transaction rolled back (if supported)
     *
     * **Note:** No 'pending' status exists in database. Pending migrations are determined
     * by comparing discovered migrations to completed/failed records.
     */
    status: 'completed' | 'failed';

    /**
     * Source category of the migration (system, module:{name}, plugin:{id}).
     *
     * Matches IMigrationMetadata.source. Stored redundantly for historical queries
     * even if source code is deleted.
     *
     * @example
     * 'system'
     * 'module:menu'
     * 'plugin:whale-alerts'
     */
    source: string;

    /**
     * Timestamp when migration execution began.
     *
     * Used for:
     * - Chronological sorting in admin UI
     * - Audit trail of when schema changes occurred
     * - Correlating migrations with deployments
     */
    executedAt: Date;

    /**
     * Migration execution duration in milliseconds.
     *
     * Measured from start of up() method to completion (success or failure).
     * Useful for:
     * - Identifying slow migrations
     * - Performance optimization
     * - Admin UI progress estimates
     *
     * @example
     * 1543  // 1.5 seconds
     * 45000 // 45 seconds
     */
    executionDuration: number;

    /**
     * Error message if migration failed.
     *
     * The `.message` property of the caught Error object. Displayed in admin UI
     * for debugging. Omitted for successful migrations.
     *
     * @example
     * 'Collection "users" already exists'
     * 'Index creation failed: duplicate key error'
     */
    error?: string;

    /**
     * Full error stack trace if migration failed.
     *
     * The `.stack` property of the caught Error object. Stored for detailed
     * debugging but not displayed in admin UI by default (expandable detail).
     *
     * @example
     * 'Error: Collection "users" already exists\n    at up (001_create_users.ts:15:23)\n    ...'
     */
    errorStack?: string;

    /**
     * SHA-256 checksum of migration file at execution time.
     *
     * Matches IMigrationMetadata.checksum. Stored to detect post-execution
     * modifications. If current file checksum differs from this value,
     * admin UI shows warning.
     *
     * @example
     * 'a3b5c7d9e1f2g3h4i5j6k7l8m9n0o1p2q3r4s5t6u7v8w9x0y1z2a3b4c5d6e7f8g9h0'
     */
    checksum?: string;

    /**
     * NODE_ENV value when migration executed.
     *
     * Helps identify environment-specific issues. Recorded but not used for
     * execution logic (migrations should be environment-agnostic).
     *
     * @example
     * 'development'
     * 'production'
     */
    environment?: string;

    /**
     * Git commit hash when migration executed.
     *
     * Attempts to capture `git rev-parse HEAD` output at execution time.
     * Undefined if git command fails or repository not found. Useful for
     * correlating migrations with specific deployments.
     *
     * @example
     * 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0'
     * undefined
     */
    codebaseVersion?: string;
}

/**
 * Sorting strategy for migration execution order.
 *
 * Determines how migrations are ordered before dependency resolution:
 * - `'timestamp'` - Sort by IMigrationMetadata.timestamp (chronological)
 * - `'id'` - Sort by IMigration.id lexicographically (numeric prefix provides order)
 * - `'source-then-id'` - Sort by source first, then by ID within each source
 *
 * **Default:** `'id'`
 *
 * Why 'id' is default:
 * Migration IDs use numeric prefixes (001, 002, 003) that naturally sort
 * chronologically within a source. This is more reliable than filesystem
 * timestamps which can be incorrect on cloned repos or Docker builds.
 */
export type MigrationSortStrategy = 'timestamp' | 'id' | 'source-then-id';

/**
 * Status summary of the migration system.
 *
 * Returned by status API endpoint and used by admin UI to render overview.
 * Provides high-level metrics without loading all migration details.
 */
export interface IMigrationStatus {
    /**
     * Pending migrations ready to execute, sorted in topological order.
     *
     * Dependencies are resolved, so executing these in order is safe.
     * Empty array if no migrations pending.
     *
     * Note: This is the serializable version without the 'up' function.
     */
    pending: Array<{
        id: string;
        description: string;
        source: string;
        filePath: string;
        timestamp: Date;
        dependencies: string[];
        checksum?: string;
    }>;

    /**
     * Completed migrations from database, sorted by executedAt descending.
     *
     * Includes both successful and failed executions. Filter by status field
     * to distinguish.
     */
    completed: IMigrationRecord[];

    /**
     * Whether a migration is currently executing.
     *
     * Used by admin UI to disable execution buttons and show progress indicator.
     * Migration system enforces serial execution (no concurrency).
     */
    isRunning: boolean;

    /**
     * Total count of pending migrations.
     *
     * Matches `pending.length` but provided as separate field for convenience.
     */
    totalPending: number;

    /**
     * Total count of completed migrations (includes both succeeded and failed).
     *
     * Matches `completed.length` but provided as separate field for convenience.
     */
    totalCompleted: number;
}

/**
 * Result of executing one or more migrations.
 *
 * Returned by execute API endpoint. Provides details about which migrations
 * ran and whether any failed.
 */
export interface IMigrationExecutionResult {
    /**
     * Whether all requested migrations executed successfully.
     *
     * - `true` - All migrations completed without errors
     * - `false` - One or more migrations failed (see `failed` field)
     */
    success: boolean;

    /**
     * Array of migration IDs that executed successfully.
     *
     * Migrations are listed in execution order. If a migration fails,
     * migrations after it do not appear in this array.
     *
     * @example
     * ['001_create_users', '002_create_roles', '003_add_indexes']
     */
    executed: string[];

    /**
     * Details of the first failed migration.
     *
     * Undefined if all migrations succeeded. Execution stops on first failure,
     * so only one migration can fail per execution attempt.
     */
    failed?: {
        /**
         * ID of the migration that failed.
         *
         * @example
         * '004_migrate_legacy_data'
         */
        migrationId: string;

        /**
         * Error message from the failed migration.
         *
         * @example
         * 'Collection "legacy_users" not found'
         */
        error: string;
    };
}
