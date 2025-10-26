import type { IDatabaseService } from './IDatabaseService.js';

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
     * **Cross-source references:**
     * When declaring dependencies on migrations from other sources, use the full qualified ID:
     * - System migration dependency: `'042_add_menu_namespace_index'`
     * - Plugin migration dependency: `'whale-alerts:003_add_threshold_index'`
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
     * **Cross-boundary dependencies:**
     * Plugins can depend on system migrations, system can depend on module migrations,
     * and plugins can depend on other plugins. Use fully qualified IDs when referencing
     * migrations from other sources.
     *
     * **Qualified ID format:**
     * - System migration: `'042_add_menu_index'`
     * - Module migration: `'module:menu:005_add_container_nodes'`
     * - Plugin migration: `'plugin:whale-alerts:003_create_subscriptions'`
     *
     * @example
     * ```typescript
     * // No dependencies (independent migration)
     * dependencies: []
     *
     * // Depends on single system migration
     * dependencies: ['001_create_config']
     *
     * // Depends on multiple migrations from same source
     * dependencies: ['001_create_users', '002_create_roles']
     *
     * // Cross-source dependencies (plugin depends on system and another plugin)
     * dependencies: [
     *     '001_create_users',                           // System migration
     *     'plugin:whale-alerts:002_create_alerts'       // Another plugin
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
     * @param database - Database service with CRUD operations, index management, and raw collection access
     * @returns Promise that resolves when migration completes successfully
     * @throws Error if migration fails (triggers transaction rollback and stops execution)
     *
     * @example
     * ```typescript
     * async up(database: IDatabaseService): Promise<void> {
     *     // Example 1: Create index
     *     await database.createIndex('transactions',
     *         { blockNumber: 1, timestamp: -1 },
     *         { name: 'idx_block_time' }
     *     );
     *
     *     // Example 2: Data transformation with raw collection access
     *     const collection = database.getCollection('users');
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
     *
     *     // Example 3: Validation before operation
     *     const configExists = await database.findOne('system_config', { key: 'version' });
     *     if (!configExists) {
     *         throw new Error('System config not initialized. Run migration 001_init_config first.');
     *     }
     * }
     * ```
     */
    up(database: IDatabaseService): Promise<void>;
}
