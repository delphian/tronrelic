import { connectDatabase } from '../../../loaders/database.js';
import { logger } from '../../../lib/logger.js';
import { PluginDatabaseService } from '../../../services/database/index.js';

/**
 * Migration: Add namespace field to existing menu nodes.
 *
 * This migration adds the `namespace` field to all existing menu nodes in the
 * `core_menu_nodes` collection, setting it to 'main' for backward compatibility.
 *
 * This migration is idempotent - it can be run multiple times safely. Nodes that
 * already have a namespace field will not be modified.
 *
 * Run with: npx tsx apps/backend/src/modules/menu/migrations/001-add-namespace.ts
 */
async function migrate() {
    try {
        logger.info('Starting migration: Add namespace field to menu nodes');

        await connectDatabase();
        const menuDatabase = new PluginDatabaseService('core');
        const collection = menuDatabase.getCollection('menu_nodes');

        // Count nodes without namespace field
        const nodesWithoutNamespace = await collection.countDocuments({
            namespace: { $exists: false }
        });

        logger.info({ count: nodesWithoutNamespace }, 'Found menu nodes without namespace field');

        if (nodesWithoutNamespace === 0) {
            logger.info('No nodes to migrate - all nodes already have namespace field');
            process.exit(0);
        }

        // Update all nodes without namespace to use 'main'
        const result = await collection.updateMany(
            { namespace: { $exists: false } },
            { $set: { namespace: 'main' } }
        );

        logger.info(
            {
                matchedCount: result.matchedCount,
                modifiedCount: result.modifiedCount
            },
            'Migration completed'
        );

        // Create index for efficient namespace queries
        logger.info('Creating index on namespace field...');
        await collection.createIndex({ namespace: 1, parent: 1, order: 1 });
        logger.info('Index created successfully');

        process.exit(0);
    } catch (error) {
        logger.error({ error }, 'Migration failed');
        process.exit(1);
    }
}

void migrate();
