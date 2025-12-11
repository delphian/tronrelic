import type { IPluginDatabase, ISystemLogService } from '@tronrelic/types';
import type { IResourceTrackingConfig, IPoolDelegation, IPoolDelegationHourly } from '../shared/types/index.js';

/**
 * Purge old delegation transactions and summation data based on retention policies.
 *
 * This job runs hourly (configurable) to:
 * 1. Aggregate pool-delegations into hourly summaries BEFORE pruning
 * 2. Remove raw pool-delegations older than 48 hours
 * 3. Remove delegation transaction details older than configured retention
 * 4. Remove aggregated summation data older than configured retention
 *
 * The hourly aggregation matches the old system's rm_delegation_hourly_volume pattern,
 * extended to support per-pool granularity for historical pool volume charts.
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

        // Step 1: Aggregate pool-delegations into hourly summaries BEFORE purging
        // This preserves historical data while allowing raw data to be pruned
        await aggregatePoolDelegationsHourly(database, logger);

        // Step 2: Purge raw pool-delegations older than 48 hours
        // Raw data is kept for recent detail views and real-time doughnut chart
        // Uses createdAt (DB insertion time) not timestamp (blockchain tx time) to avoid
        // immediately purging historical data during catch-up sync (Issue #81)
        const poolDelegationsCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
        const poolDelegationsDeleted = await database.deleteMany(
            'pool-delegations',
            { createdAt: { $lt: poolDelegationsCutoff } }
        );

        logger.info(
            {
                deletedCount: poolDelegationsDeleted,
                cutoffDate: poolDelegationsCutoff,
                retentionHours: 48
            },
            'Purged old pool-delegations'
        );

        // Step 3: Purge old delegation transactions (general tracking)
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

        // Step 4: Purge old summation data
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
                poolDelegationsDeleted,
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

/**
 * Aggregate raw pool-delegations into hourly summaries per pool.
 *
 * Processes delegations from the last 2 hours (with overlap for safety) and
 * upserts hourly aggregates. Uses MongoDB aggregation pipeline for efficiency.
 *
 * Matches old system behavior from logRMDelegation.js getLastHourVolume(),
 * extended to store per-pool data rather than global network totals.
 *
 * @param database - Plugin-scoped database service
 * @param logger - Scoped logger for aggregation tracking
 */
async function aggregatePoolDelegationsHourly(
    database: IPluginDatabase,
    logger: ISystemLogService
): Promise<void> {
    try {
        // Process last 2 hours of data (with overlap to catch any missed aggregations)
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

        const collection = database.getCollection('pool-delegations');
        const hourlyCollection = database.getCollection('pool-delegations-hourly');

        // Aggregate by pool + hour + resourceType
        const aggregationResult = await collection.aggregate<{
            _id: { poolAddress: string | null; dateHour: string; resourceType: number };
            timestamp: number;
            totalAmountTrx: number;
            totalNormalizedAmountTrx: number;
            delegationCount: number;
            uniqueDelegators: string[];
            uniqueRecipients: string[];
        }>([
            // Filter to recent data
            { $match: { timestamp: { $gte: twoHoursAgo } } },

            // Group by pool + hour + resource type
            {
                $group: {
                    _id: {
                        poolAddress: '$poolAddress',
                        dateHour: {
                            $dateToString: {
                                format: '%Y-%m-%d %H',
                                date: '$timestamp'
                            }
                        },
                        resourceType: '$resourceType'
                    },
                    // Calculate hour start timestamp (seconds)
                    timestamp: {
                        $first: {
                            $toLong: {
                                $dateTrunc: {
                                    date: '$timestamp',
                                    unit: 'hour'
                                }
                            }
                        }
                    },
                    // Sum amounts (convert from SUN to TRX, use absolute values)
                    totalAmountTrx: {
                        $sum: {
                            $divide: [{ $abs: '$amountSun' }, 1_000_000]
                        }
                    },
                    totalNormalizedAmountTrx: {
                        $sum: { $ifNull: ['$normalizedAmountTrx', 0] }
                    },
                    delegationCount: { $sum: 1 },
                    uniqueDelegators: { $addToSet: '$fromAddress' },
                    uniqueRecipients: { $addToSet: '$toAddress' }
                }
            }
        ]).toArray();

        if (aggregationResult.length === 0) {
            logger.debug('No pool delegations to aggregate');
            return;
        }

        // Upsert each hourly aggregate
        let upsertedCount = 0;
        for (const agg of aggregationResult) {
            const hourKey = `${agg._id.dateHour}:${agg._id.poolAddress ?? 'global'}:${agg._id.resourceType}`;

            const hourlyDoc: IPoolDelegationHourly = {
                hourKey,
                dateHour: agg._id.dateHour,
                timestamp: Math.floor(agg.timestamp / 1000), // Convert to seconds
                poolAddress: agg._id.poolAddress,
                resourceType: agg._id.resourceType as 0 | 1,
                totalAmountTrx: agg.totalAmountTrx,
                totalNormalizedAmountTrx: agg.totalNormalizedAmountTrx,
                delegationCount: agg.delegationCount,
                uniqueDelegators: agg.uniqueDelegators.length,
                uniqueRecipients: agg.uniqueRecipients.length,
                createdAt: new Date()
            };

            // Upsert: update if exists (in case of re-aggregation), insert if new
            await hourlyCollection.updateOne(
                { hourKey },
                {
                    $set: {
                        dateHour: hourlyDoc.dateHour,
                        timestamp: hourlyDoc.timestamp,
                        poolAddress: hourlyDoc.poolAddress,
                        resourceType: hourlyDoc.resourceType,
                        totalAmountTrx: hourlyDoc.totalAmountTrx,
                        totalNormalizedAmountTrx: hourlyDoc.totalNormalizedAmountTrx,
                        delegationCount: hourlyDoc.delegationCount,
                        uniqueDelegators: hourlyDoc.uniqueDelegators,
                        uniqueRecipients: hourlyDoc.uniqueRecipients
                    },
                    $setOnInsert: {
                        createdAt: new Date()
                    }
                },
                { upsert: true }
            );
            upsertedCount++;
        }

        logger.info(
            {
                aggregatedHours: upsertedCount,
                sourceDelegations: aggregationResult.reduce((sum, a) => sum + a.delegationCount, 0)
            },
            'Pool delegations hourly aggregation completed'
        );
    } catch (error) {
        logger.error({ error }, 'Failed to aggregate pool delegations hourly');
        // Don't throw - aggregation failure shouldn't block purge job
    }
}
