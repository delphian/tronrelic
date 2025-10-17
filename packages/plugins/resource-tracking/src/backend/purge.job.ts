import type { IPluginDatabase, ILogger } from '@tronrelic/types';
import type { IResourceTrackingConfig } from '../shared/types/index.js';

/**
 * Purge old delegation transactions and summation data based on retention policies.
 *
 * This job runs hourly (configurable) to remove data older than the configured
 * retention periods. Delegation transaction details are kept for 48 hours by default,
 * while aggregated summation data is retained for 6 months by default.
 *
 * The purge job ensures storage requirements remain manageable while preserving
 * enough historical data for analysis and debugging. Retention periods can be
 * adjusted via the plugin settings without code changes.
 *
 * @param database - Plugin-scoped database service for deleting expired records
 * @param logger - Scoped logger for job execution tracking
 */
export async function runPurgeJob(database: IPluginDatabase, logger: ILogger): Promise<void> {
    logger.debug('Starting purge job');

    try {
        // Load configuration
        const config = await database.get<IResourceTrackingConfig>('config');
        if (!config) {
            logger.warn('No configuration found, skipping purge job');
            return;
        }

        const { detailsRetentionDays, summationRetentionMonths } = config;

        // Calculate cutoff dates
        const transactionCutoff = new Date();
        transactionCutoff.setDate(transactionCutoff.getDate() - detailsRetentionDays);

        const summationCutoff = new Date();
        summationCutoff.setMonth(summationCutoff.getMonth() - summationRetentionMonths);

        // Purge old delegation transactions
        const transactionsDeleted = await database.deleteMany(
            'transactions',
            { timestamp: { $lt: transactionCutoff } }
        );

        logger.info(
            {
                deletedCount: transactionsDeleted,
                cutoffDate: transactionCutoff,
                retentionDays: detailsRetentionDays
            },
            'Purged old delegation transactions'
        );

        // Purge old summation data
        const summationsDeleted = await database.deleteMany(
            'summations',
            { timestamp: { $lt: summationCutoff } }
        );

        logger.info(
            {
                deletedCount: summationsDeleted,
                cutoffDate: summationCutoff,
                retentionMonths: summationRetentionMonths
            },
            'Purged old summation data'
        );

        logger.info(
            {
                transactionsDeleted,
                summationsDeleted
            },
            'Purge job completed'
        );
    } catch (error) {
        logger.error({ error }, 'Failed to run purge job');
        throw error;
    }
}
