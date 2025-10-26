import type { IMigration, IDatabaseService } from '@tronrelic/types';

/**
 * Example plugin migration: Seed default whale threshold configuration.
 *
 * This migration demonstrates:
 * - Plugin collection restrictions (can only access plugin-prefixed collections)
 * - Key-value storage for simple config data
 * - Dependencies on system migrations
 * - Idempotent seeding (check before insert)
 *
 * Why this migration exists:
 * The whale-alerts plugin requires default threshold configuration on first install.
 * Without this migration, the plugin would fail to start due to missing config.
 * This migration seeds the required defaults into plugin-scoped storage.
 *
 * IMPORTANT: Plugin migrations can ONLY access collections with the plugin prefix.
 * Attempting to access 'users' or 'system_config' will throw an error.
 * Use plugin-prefixed collections like 'subscriptions' (auto-prefixed to 'plugin_whale-alerts_subscriptions')
 * or use key-value storage via database.set().
 */
export const migration: IMigration = {
    id: '001_example_whale_threshold_config',
    description: 'Seed default whale alert threshold configuration. Sets minimum TRX transfer amount (1M TRX) and minimum USD value ($100k) for alerts.',
    dependencies: ['001_example_add_index'], // Depends on system migration (indexes must exist first)

    async up(database: IDatabaseService): Promise<void> {
        // Check if config already exists (idempotent)
        const existingConfig = await database.get<any>('whale_threshold_config');

        if (existingConfig) {
            // Config already seeded, skip
            return;
        }

        // Seed default threshold configuration using key-value storage
        // This is scoped to the whale-alerts plugin automatically
        await database.set('whale_threshold_config', {
            minTrxAmount: 1_000_000_000_000, // 1M TRX in SUN (1 TRX = 1M SUN)
            minUsdValue: 100_000, // $100k USD
            enabled: true,
            createdAt: new Date()
        });

        // Also create an index on the subscriptions collection for fast user lookups
        // This collection is automatically prefixed to 'plugin_whale-alerts_subscriptions'
        await database.createIndex(
            'subscriptions',
            { userId: 1, enabled: 1 },
            { name: 'idx_user_enabled' }
        );
    }
};
