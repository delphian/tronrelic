import type { IPluginDatabase, ISystemLogService } from '@tronrelic/types';
import type { IResourceTrackingConfig } from '../shared/types/index.js';

/**
 * Purge old delegation transactions and summation data based on retention policies.
 *
 * This job runs hourly (configurable) to:
 * 1. Remove delegation transaction details older than configured retention
 * 2. Remove aggregated summation data older than configured retention
 *
 * @param database - Plugin-scoped database service for deleting expired records
 * @param logger - Scoped logger for job execution tracking
 */
export async function runPurgeJob(database: IPluginDatabase, logger: ISystemLogService): Promise<void> {
    logger.debug('Starting purge job');

    try {
        // Load configuration
        const config = await database.get<IResourceTrackingConfig>('config');
        if (!config) {
            logger.warn('No configuration found, skipping purge job');
            return;
        }

        const { detailsRetentionDays, summationRetentionMonths } = config;

        // Purge old delegation transactions (general tracking)
        // Uses createdAt (DB insertion time) not timestamp (blockchain tx time) to avoid
        // immediately purging historical data during catch-up sync (Issue #81)
        const transactionCutoff = new Date();
        transactionCutoff.setDate(transactionCutoff.getDate() - detailsRetentionDays);

        const transactionsDeleted = await database.deleteMany(
            'transactions',
            { createdAt: { $lt: transactionCutoff } }
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
        const summationCutoff = new Date();
        summationCutoff.setMonth(summationCutoff.getMonth() - summationRetentionMonths);

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
