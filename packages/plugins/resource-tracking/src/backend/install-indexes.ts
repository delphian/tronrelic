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

    // Index for pool-delegations collection (Permission_id >= 3 delegations)
    // - txId unique index prevents duplicate pool delegation storage
    // - poolAddress + timestamp composite for pool-specific queries and charts
    // - timestamp descending for recent delegation queries
    const poolDelegationsCollection = database.getCollection('pool-delegations');
    await poolDelegationsCollection.createIndex({ txId: 1 }, { unique: true });
    await poolDelegationsCollection.createIndex({ poolAddress: 1, timestamp: -1 });
    await poolDelegationsCollection.createIndex({ timestamp: -1 });
    await poolDelegationsCollection.createIndex({ fromAddress: 1, timestamp: -1 });
    await poolDelegationsCollection.createIndex({ toAddress: 1, timestamp: -1 });

    logger.info('Created indexes for pool-delegations collection');

    // Index for pool-members collection (account-to-pool mappings)
    // - Compound unique on account + pool prevents duplicate memberships
    // - pool index for finding all members of a specific pool
    // - lastSeenAt for activity-based queries
    const poolMembersCollection = database.getCollection('pool-members');
    await poolMembersCollection.createIndex({ account: 1, pool: 1 }, { unique: true });
    await poolMembersCollection.createIndex({ pool: 1 });
    await poolMembersCollection.createIndex({ lastSeenAt: -1 });

    logger.info('Created indexes for pool-members collection');

    // Index for address-book collection (human-readable names)
    // - address unique index for fast lookups
    // - category index for filtering by type (pool, exchange, notable)
    const addressBookCollection = database.getCollection('address-book');
    await addressBookCollection.createIndex({ address: 1 }, { unique: true });
    await addressBookCollection.createIndex({ category: 1 });

    logger.info('Created indexes for address-book collection');

    // Index for pool-delegations-hourly collection (aggregated hourly volumes per pool)
    // - hourKey unique index for upsert operations during aggregation
    // - poolAddress + timestamp for pool-specific historical queries
    // - timestamp for time-range queries across all pools
    const poolDelegationsHourlyCollection = database.getCollection('pool-delegations-hourly');
    await poolDelegationsHourlyCollection.createIndex({ hourKey: 1 }, { unique: true });
    await poolDelegationsHourlyCollection.createIndex({ poolAddress: 1, timestamp: -1 });
    await poolDelegationsHourlyCollection.createIndex({ timestamp: -1 });
    await poolDelegationsHourlyCollection.createIndex({ resourceType: 1, timestamp: -1 });

    logger.info('Created indexes for pool-delegations-hourly collection');

    logger.info('Resource tracking indexes created successfully');
}
