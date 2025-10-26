import type { IMigration, IDatabaseService } from '@tronrelic/types';

/**
 * Example system migration: Add index to improve query performance.
 *
 * This migration demonstrates:
 * - Simple index creation using createIndex()
 * - System migrations have unrestricted collection access
 * - No dependencies (independent migration)
 * - Idempotent operation (createIndex is safe to run multiple times)
 *
 * Why this migration exists:
 * Queries filtering system_config by namespace and active status are slow
 * without an index. This migration adds a compound index to optimize
 * the primary configuration query pattern.
 */
export const migration: IMigration = {
    id: '001_example_add_index',
    description: 'Add compound index on system_config (namespace, active) to optimize configuration queries. Reduces query time from ~50ms to ~2ms.',
    dependencies: [],

    async up(database: IDatabaseService): Promise<void> {
        // Create compound index on system_config collection
        // This optimizes queries that filter by namespace and active status
        await database.createIndex(
            'system_config',
            { namespace: 1, active: 1 },
            { name: 'idx_namespace_active' }
        );
    }
};
