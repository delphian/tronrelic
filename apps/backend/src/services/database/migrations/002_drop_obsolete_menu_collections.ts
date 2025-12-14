import type { IMigration, IMigrationContext } from '@tronrelic/types';

/**
 * Drop obsolete menu collections created by incorrect database prefixing.
 *
 * **Why this migration exists:**
 * The MenuService was incorrectly initialized with a 'core_' database prefix, causing
 * it to create `core_menu_nodes` instead of using the intended `menu_nodes` collection.
 * This resulted in multiple menu collections with duplicate and stale data.
 *
 * **Root cause (fixed in apps/backend/src/index.ts):**
 * ```typescript
 * // WRONG (before fix):
 * const menuDatabase = new DatabaseService(logger, { prefix: 'core_' });
 *
 * // CORRECT (after fix):
 * const menuDatabase = new DatabaseService(logger); // No prefix for system services
 * ```
 *
 * **Collections being dropped:**
 * - `core_menu_nodes` → incorrectly prefixed menu collection
 * - `plugin_core_menu_nodes` → incorrectly prefixed plugin collection
 * - `menunodes` → legacy collection from old naming convention
 *
 * **Authoritative collection (preserved):**
 * - `menu_nodes` → correct system collection used by MenuService after fix
 *
 * **Impact:**
 * - Removes duplicate and stale menu entries
 * - No data loss (all active menu items are in `menu_nodes` or runtime-only)
 * - Plugin menu items are runtime-only and recreated on each plugin init
 * - No application downtime or service interruption
 *
 * **Architecture notes:**
 * - System services (MenuService, LogsModule, etc.) use unprefixed collections
 * - Plugins use prefixed collections (e.g., `plugin_whale-alerts_subscriptions`)
 * - MenuService should never have been prefixed - it's core infrastructure
 *
 * **Rollback:**
 * No rollback needed. Obsolete collections contain duplicate/stale data.
 * Current state is preserved in `menu_nodes`.
 */
export const migration: IMigration = {
    id: '002_drop_obsolete_menu_collections',
    description: 'Drop obsolete menu collections (core_menu_nodes, plugin_core_menu_nodes, menunodes) created by incorrect database prefixing. Preserves authoritative menu_nodes collection.',
    dependencies: [],

    async up(context: IMigrationContext): Promise<void> {
        const collectionsToRemove = [
            'core_menu_nodes',
            'plugin_core_menu_nodes',
            'menunodes'
        ];

        for (const collectionName of collectionsToRemove) {
            try {
                // Attempt to drop the collection
                // MongoDB will throw if collection doesn't exist
                const collection = context.database.getCollection(collectionName);
                await collection.drop();
                console.log(`[Migration] Dropped obsolete collection: ${collectionName}`);
            } catch (error) {
                // If collection doesn't exist, MongoDB throws "ns not found" - this is expected and safe
                if (error instanceof Error && error.message.includes('ns not found')) {
                    console.log(`[Migration] Skipped (not found): ${collectionName}`);
                } else {
                    // Unexpected error, rethrow to trigger rollback
                    throw new Error(`Failed to drop collection ${collectionName}: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        }

        console.log('[Migration] Successfully cleaned up all obsolete menu collections');
        console.log('[Migration] Authoritative menu_nodes collection preserved');
    }
};
