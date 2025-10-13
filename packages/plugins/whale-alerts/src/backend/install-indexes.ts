import type { IPluginContext } from '@tronrelic/types';

/**
 * Create database indexes for whale transactions.
 *
 * Sets up indexes for efficient querying of whale transaction data.
 *
 * @param context - Plugin context with database access
 */
export async function createWhaleIndexes(context: IPluginContext): Promise<void> {
    const collection = context.database.getCollection('transactions');

    await collection.createIndex({ txId: 1 }, { unique: true });
    await collection.createIndex({ timestamp: -1 });
    await collection.createIndex({ amountTRX: -1 });
    await collection.createIndex({ fromAddress: 1 });
    await collection.createIndex({ toAddress: 1 });
    await collection.createIndex({ notifiedAt: 1, timestamp: -1 });

    context.logger.info('Created whale transaction indexes');
}
