import type { IDatabaseService } from './IDatabaseService.js';
import type { IClickHouseService } from '../clickhouse/IClickHouseService.js';

/**
 * Target database for migration execution.
 *
 * - `mongodb` (default): Migration executes against MongoDB via IDatabaseService
 * - `clickhouse`: Migration executes against ClickHouse via IClickHouseService
 */
export type MigrationTarget = 'mongodb' | 'clickhouse';

/**
 * Context provided to migration up() function.
 *
 * Contains access to both database services. Migrations targeting MongoDB
 * use the `database` property; migrations targeting ClickHouse use the
 * `clickhouse` property.
 *
 * **Note:** The `clickhouse` property is undefined if ClickHouse is not
 * configured. Migrations targeting ClickHouse will be skipped with a
 * warning in this case.
 */
export interface IMigrationContext {
    /** MongoDB database service (always available) */
    database: IDatabaseService;

    /** ClickHouse service (undefined if not configured) */
    clickhouse?: IClickHouseService;
}

/**
 * Database migration interface for schema evolution and data transformations.
 *
 * Migrations enable incremental database changes with dependency tracking, ensuring
 * changes execute in the correct order across system code, modules, and plugins.
 *
 * **Key principles:**
 * - **Forward-only**: No rollback support. If a migration fails, write a new forward migration to fix it.
 * - **Idempotency recommended**: Migrations should be safe to run multiple times (though tracking prevents re-runs).
 * - **Sequential IDs**: Use numeric prefixes (001, 002, 003) for clear ordering within a source.
 * - **Dependency-aware**: Declare dependencies on other migrations to enforce execution order.
 *
 * **Transaction behavior:**
 * Migrations execute within MongoDB transactions when supported (replica set deployments).
 * If a transaction fails to roll back, the application will crash to prevent data corruption.
 *
 * **Access control:**
 * - System migrations: Unrestricted access to all collections
 * - Module migrations: Unrestricted access to all collections
 * - Plugin migrations: Restricted to plugin-prefixed collections only (e.g., `plugin_whale-alerts_*`)
 *
 * @example
 * ```typescript
 * // System migration: apps/backend/src/services/database/migrations/001_create_users.ts
 * export const migration: IMigration = {
 *     id: '001_create_users',
 *     description: 'Create users collection with unique email index',
 *     dependencies: [],
 *
 *     async up(database: IDatabaseService): Promise<void> {
 *         const collection = database.getCollection('users');
 *         await database.createIndex('users', { email: 1 }, { unique: true });
 *     }
 * };
 *
 * // Plugin migration with dependency: packages/plugins/whale-alerts/src/backend/migrations/001_create_subscriptions.ts
 * export const migration: IMigration = {
 *     id: '001_create_subscriptions',
 *     description: 'Create whale alert subscriptions collection',
 *     dependencies: ['001_create_users'], // Depends on system migration
 *
 *     async up(database: IDatabaseService): Promise<void> {
 *         const collection = database.getCollection('subscriptions');
 *         await database.createIndex('subscriptions', { userId: 1, enabled: 1 });
 *     }
 * };
 * ```
 */
export interface IMigration {
    /**
     * Unique migration identifier with sequential number and description.
     *
     * Format: `{number}_{snake_case_description}`
     *
     * The numeric prefix establishes ordering within a source (system, module, or plugin).
     * Use leading zeros for sortability (001, 002, ..., 010, 011, ..., 100).
     *
     * **Naming rules:**
     * - Must start with 3 digits followed by underscore
     * - Description uses lowercase letters, numbers, hyphens, and underscores only
     * - Keep descriptions concise but meaningful
     *
     * **Examples:**
     * - `001_create_users_table`
     * - `042_add_menu_namespace_index`
     * - `123_migrate_legacy_transaction_format`
     *
     * @example
     * ```typescript
     * // Good IDs
     * id: '001_create_config'
     * id: '042_add_indexes'
     * id: '123_migrate_legacy_data'
     *
     * // Bad IDs (will be rejected)
     * id: '1_create_config'           // Not enough leading zeros
     * id: '001-create-config'         // Hyphen instead of underscore separator
     * id: '001_CreateConfig'          // Uppercase letters
     * id: 'create_config'             // Missing numeric prefix
     * ```
     */
    id: string;

    /**
     * Human-readable description explaining the migration's purpose and impact.
     *
     * Focus on the **why** this migration exists, not just what it does. Explain:
     * - What problem this solves
     * - What changes to expect
     * - Any performance or behavior impacts
     * - Data transformations applied
     *
     * This description appears in admin UI and helps operators understand the migration's
     * purpose when reviewing pending changes.
     *
     * @example
     * ```typescript
     * // Good descriptions (explain why)
     * description: 'Add compound index on menu_nodes (namespace, order) to optimize primary menu query. Reduces query time from 50ms to 2ms.'
     * description: 'Migrate legacy transaction format from flat structure to nested contracts array. Required for new observer pattern.'
     *
     * // Weak descriptions (only what)
     * description: 'Add index'
     * description: 'Update transactions'
     * ```
     */
    description: string;

    /**
     * Target database for this migration.
     *
     * - `mongodb` (default): Migration executes against MongoDB
     * - `clickhouse`: Migration executes against ClickHouse
     *
     * When targeting ClickHouse, the migration's up() function should use
     * `context.clickhouse` instead of `context.database`. If ClickHouse is
     * not configured, the migration will be skipped with a warning.
     *
     * @default 'mongodb'
     *
     * @example
     * ```typescript
     * // MongoDB migration (default, target can be omitted)
     * export const migration: IMigration = {
     *     id: '001_create_users',
     *     description: 'Create users collection',
     *     target: 'mongodb',  // Optional, this is the default
     *     async up(context) {
     *         await context.database.createIndex('users', { email: 1 }, { unique: true });
     *     }
     * };
     *
     * // ClickHouse migration
     * export const migration: IMigration = {
     *     id: '001_create_delegations',
     *     description: 'Create delegations table in ClickHouse',
     *     target: 'clickhouse',
     *     async up(context) {
     *         await context.clickhouse!.exec(`
     *             CREATE TABLE delegations (...)
     *             ENGINE = MergeTree()
     *         `);
     *     }
     * };
     * ```
     */
    target?: MigrationTarget;

    /**
     * Optional array of migration IDs that must execute before this migration.
     *
     * The migration system uses these dependencies to build a topological execution order,
     * ensuring migrations run in the correct sequence even across different sources
     * (system, modules, plugins).
     *
     * **Dependency resolution:**
     * - Dependencies are validated before execution
     * - Circular dependencies are detected and rejected at startup
     * - Missing dependencies cause migration to be skipped with error
     * - Execution stops if any dependency fails
     *
     * **Dependency ID format:**
     * The format depends on which source owns the target migration. The scanner looks up
     * migrations by their `qualifiedId`, which differs by source:
     *
     * - **System migrations** - Use plain ID: `'001_create_users'` (system qualifiedId IS the plain ID)
     * - **Module migrations** - Use qualified ID: `'module:menu:001_add_namespace'`
     * - **Plugin migrations** - Use qualified ID: `'plugin:whale-alerts:001_init'`
     *
     * **Why this matters:**
     * System migrations have `qualifiedId = id`, so plain IDs work. Module and plugin migrations
     * have prefixed qualified IDs, so you must include the prefix or the dependency won't be found.
     *
     * @example
     * ```typescript
     * // No dependencies (independent migration)
     * dependencies: []
     *
     * // Depends on single system migration (plain ID works)
     * dependencies: ['001_create_users']
     *
     * // Depends on multiple system migrations (plain IDs work)
     * dependencies: ['001_create_users', '002_create_roles']
     *
     * // Cross-source dependencies (plugin depends on system and module)
     * dependencies: [
     *     '001_create_users',                    // System migration (plain ID)
     *     'module:menu:001_add_namespace'        // Module migration (qualified ID required)
     * ]
     *
     * // Plugin depending on another plugin
     * dependencies: [
     *     'plugin:whale-alerts:001_init'         // Plugin migration (qualified ID required)
     * ]
     * ```
     */
    dependencies?: string[];

    /**
     * Execute the migration with full database service access.
     *
     * This method receives the `IDatabaseService` instance providing:
     * - Raw MongoDB collection access via `getCollection()`
     * - Convenience CRUD methods (`find`, `findOne`, `insertOne`, etc.)
     * - Index creation via `createIndex()`
     * - Key-value storage via `get()` / `set()`
     * - Registered Mongoose models (if available)
     *
     * **Access restrictions:**
     * - **System/module migrations**: No restrictions, can access any collection
     * - **Plugin migrations**: Can only access collections with plugin prefix (e.g., `plugin_whale-alerts_*`)
     *   Attempting to access non-prefixed collections will throw an error.
     *
     * **Transaction behavior:**
     * MongoDB transactions are used automatically when:
     * - Deployment is a replica set (transactions require replica set)
     * - Connection supports sessions
     *
     * If transactions are not supported, migration runs without transaction protection.
     *
     * **Transaction rollback:**
     * If migration throws an error:
     * 1. MongoDB transaction rolls back automatically (if transactions enabled)
     * 2. Migration is marked as failed in tracking collection
     * 3. Execution of remaining migrations stops
     * 4. **If rollback fails**, application crashes with fatal error (prevents data corruption)
     *
     * **Error handling:**
     * Throw descriptive errors to help diagnose failures:
     * ```typescript
     * if (!user) {
     *     throw new Error('Required system user not found. Run migration 001_create_users first.');
     * }
     * ```
     *
     * **Best practices:**
     * - Validate assumptions (e.g., required collections exist)
     * - Use descriptive error messages
     * - Prefer idempotent operations when possible
     * - Add indexes for new query patterns
     * - Test migrations against realistic datasets
     * - Log progress for long-running migrations
     *
     * @param context - Migration context with access to MongoDB and optionally ClickHouse
     * @returns Promise that resolves when migration completes successfully
     * @throws Error if migration fails (triggers transaction rollback and stops execution)
     *
     * @example
     * ```typescript
     * // MongoDB migration
     * async up(context: IMigrationContext): Promise<void> {
     *     // Create index
     *     await context.database.createIndex('transactions',
     *         { blockNumber: 1, timestamp: -1 },
     *         { name: 'idx_block_time' }
     *     );
     *
     *     // Data transformation with raw collection access
     *     const collection = context.database.getCollection('users');
     *     const users = await collection.find({ legacy: true }).toArray();
     *
     *     for (const user of users) {
     *         await collection.updateOne(
     *             { _id: user._id },
     *             {
     *                 $set: { migrated: true },
     *                 $unset: { legacy: '' }
     *             }
     *         );
     *     }
     * }
     *
     * // ClickHouse migration
     * async up(context: IMigrationContext): Promise<void> {
     *     await context.clickhouse!.exec(`
     *         CREATE TABLE IF NOT EXISTS delegations (
     *             txId String,
     *             timestamp DateTime64(3),
     *             poolAddress Nullable(String)
     *         )
     *         ENGINE = MergeTree()
     *         ORDER BY (timestamp, poolAddress)
     *         TTL timestamp + INTERVAL 90 DAY
     *     `);
     * }
     * ```
     */
    up(context: IMigrationContext): Promise<void>;
}
