import type { IMigration, IDatabaseService } from '@tronrelic/types';

/**
 * Drop legacy market system collections after migration to resource-markets plugin.
 *
 * **Why this migration exists:**
 * The resource markets functionality has been fully migrated from the legacy core
 * module (`apps/backend/src/modules/markets/`) to the resource-markets plugin
 * (`packages/plugins/resource-markets/`). All market data now lives in plugin-prefixed
 * collections (`plugin_resource-markets_*`), and the legacy collections are no longer
 * used or maintained.
 *
 * **Collections being dropped:**
 * - `markets` → replaced by `plugin_resource-markets_markets`
 * - `market_price_history` → historical data not migrated (acceptable data loss)
 * - `market_reliability` → replaced by `plugin_resource-markets_reliability`
 * - `market_reliability_history` → historical data not migrated
 * - `market_affiliate` → replaced by `plugin_resource-markets_affiliate`
 *
 * **Impact:**
 * - All historical market price data will be permanently deleted
 * - All historical reliability tracking data will be permanently deleted
 * - Plugin will start fresh with new data from next market refresh (every 10 minutes)
 * - No application downtime or service interruption
 *
 * **Rollback:**
 * No rollback possible. Data cannot be restored after deletion without backup.
 * If rollback needed, restore previous git commit and redeploy entire codebase
 * (legacy code was fully deleted, not feature-flagged).
 *
 * **References:**
 * - See PLAN.md for complete migration strategy
 * - See packages/plugins/resource-markets/ for plugin implementation
 */
export const migration: IMigration = {
    id: '001_drop_legacy_market_collections',
    description: 'Drop legacy market system collections after migration to resource-markets plugin. Removes markets, market_price_history, market_reliability, market_reliability_history, and market_affiliate collections. Historical data will be lost.',
    dependencies: [],

    async up(database: IDatabaseService): Promise<void> {
        const collectionsToRemove = [
            'markets',
            'market_price_history',
            'market_reliability',
            'market_reliability_history',
            'market_affiliate'
        ];

        for (const collectionName of collectionsToRemove) {
            try {
                // Attempt to drop the collection
                // MongoDB will throw if collection doesn't exist
                const collection = database.getCollection(collectionName);
                await collection.drop();
                console.log(`[Migration] Dropped collection: ${collectionName}`);
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

        console.log('[Migration] Successfully cleaned up all legacy market collections');
    }
};
