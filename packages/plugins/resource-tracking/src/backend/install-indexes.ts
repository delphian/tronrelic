import type { IPluginContext } from '@tronrelic/types';

/**
 * Create MongoDB indexes for resource tracking collections during plugin installation.
 *
 * Indexes are created once when the plugin is first installed to optimize query
 * performance for delegation transaction lookups and summation data retrieval.
 * The install hook ensures these indexes exist before any data is written.
 *
 * @param context - Plugin context with database service for index creation
 */
export async function createResourceTrackingIndexes(context: IPluginContext): Promise<void> {
    const { database, logger } = context;

    logger.info('Creating resource tracking database indexes');

    // Index for delegation transactions collection
    // - txId unique index prevents duplicate transaction storage
    // - timestamp index supports TTL queries and time-range lookups
    // - resourceType + timestamp composite index optimizes aggregation queries
    const transactionsCollection = database.getCollection('transactions');
    await transactionsCollection.createIndex({ txId: 1 }, { unique: true });
    await transactionsCollection.createIndex({ timestamp: 1 });
    await transactionsCollection.createIndex({ resourceType: 1, timestamp: 1 });
    await transactionsCollection.createIndex({ blockNumber: 1 });

    logger.info('Created indexes for transactions collection');

    // Index for summation data collection
    // - Block range composite index supports efficient block-based queries
    // - timestamp index supports time-range queries for chart data
    const summationsCollection = database.getCollection('summations');
    await summationsCollection.createIndex({ startBlock: 1, endBlock: 1 }, { name: 'idx_summations_block_range' });
    await summationsCollection.createIndex({ timestamp: 1 });

    logger.info('Created indexes for summations collection');

    // Index for whale delegations collection
    // - txId unique index prevents duplicate whale transaction storage
    // - timestamp descending index optimizes recent whale queries
    // - resourceType + timestamp composite index supports filtered whale queries
    const whaleDelegationsCollection = database.getCollection('whale-delegations');
    await whaleDelegationsCollection.createIndex({ txId: 1 }, { unique: true });
    await whaleDelegationsCollection.createIndex({ timestamp: -1 }); // Descending for recent queries
    await whaleDelegationsCollection.createIndex({ resourceType: 1, timestamp: -1 });

    logger.info('Created indexes for whale-delegations collection');

    logger.info('Resource tracking indexes created successfully');
}
