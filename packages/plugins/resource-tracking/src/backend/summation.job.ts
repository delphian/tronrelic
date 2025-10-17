import type { IPluginDatabase, ILogger, IPluginWebSocketManager } from '@tronrelic/types';
import type { IDelegationTransaction, ISummationData, IResourceTrackingConfig } from '../shared/types/index.js';

/**
 * Aggregate delegation transaction data into summation records every 10 minutes.
 *
 * This job queries all delegation transactions since the last summation, groups them
 * by resource type, sums delegated and reclaimed amounts, and stores aggregated
 * statistics for long-term trend analysis. Summation data has a configurable TTL
 * (default 6 months) while individual transaction details are purged after 48 hours.
 *
 * The job runs every 10 minutes and creates a single summation record per run,
 * capturing the current state of delegation flows. This provides manageable data
 * volumes for charting while preserving historical trends.
 *
 * After creating a new summation record, emits a WebSocket event to notify subscribed
 * clients that new data is available, enabling real-time chart updates without polling.
 *
 * @param database - Plugin-scoped database service for reading transactions and writing summations
 * @param logger - Scoped logger for job execution tracking
 * @param websocket - Plugin WebSocket manager for emitting real-time events to subscribed clients
 */
export async function runSummationJob(
    database: IPluginDatabase,
    logger: ILogger,
    websocket: IPluginWebSocketManager
): Promise<void> {
    logger.debug('Starting summation aggregation job');

    try {
        // Find the most recent summation timestamp to avoid double-counting
        const allSummations = await database.find<ISummationData>(
            'summations',
            {},
            { sort: { timestamp: -1 }, limit: 1 }
        );
        const lastSummation = allSummations.length > 0 ? allSummations[0] : null;

        const startTime = lastSummation?.timestamp
            ? new Date(lastSummation.timestamp.getTime())
            : new Date(Date.now() - 10 * 60 * 1000); // Default to last 10 minutes

        // Query all delegation transactions since last summation
        const transactions = await database.find<IDelegationTransaction>(
            'transactions',
            {
                timestamp: { $gte: startTime }
            }
        );

        if (transactions.length === 0) {
            logger.debug({ since: startTime }, 'No new delegation transactions to aggregate');
            return;
        }

        // Aggregate by resource type
        let energyDelegated = 0;
        let energyReclaimed = 0;
        let bandwidthDelegated = 0;
        let bandwidthReclaimed = 0;

        for (const tx of transactions) {
            const amount = Math.abs(tx.amountSun); // Use absolute value for sums
            const isDelegation = tx.amountSun > 0;

            if (tx.resourceType === 1) {
                // ENERGY
                if (isDelegation) {
                    energyDelegated += amount;
                } else {
                    energyReclaimed += amount;
                }
            } else {
                // BANDWIDTH
                if (isDelegation) {
                    bandwidthDelegated += amount;
                } else {
                    bandwidthReclaimed += amount;
                }
            }
        }

        // Calculate net flows
        const netEnergy = energyDelegated - energyReclaimed;
        const netBandwidth = bandwidthDelegated - bandwidthReclaimed;

        // Create summation record
        const summation: Omit<ISummationData, 'createdAt'> = {
            timestamp: new Date(),
            energyDelegated,
            energyReclaimed,
            bandwidthDelegated,
            bandwidthReclaimed,
            netEnergy,
            netBandwidth,
            transactionCount: transactions.length
        };

        await database.insertOne('summations', summation);

        logger.info(
            {
                timestamp: summation.timestamp,
                transactionCount: transactions.length,
                energyDelegated,
                energyReclaimed,
                netEnergy,
                bandwidthDelegated,
                bandwidthReclaimed,
                netBandwidth
            },
            'Summation aggregation completed'
        );

        // Emit WebSocket event to notify subscribed clients of new summation data
        // Room name 'summation-updates' matches what clients subscribe to
        // Event name 'summation-created' identifies this specific event type
        websocket.emitToRoom('summation-updates', 'summation-created', {
            timestamp: summation.timestamp.toISOString(),
            energyDelegated,
            energyReclaimed,
            bandwidthDelegated,
            bandwidthReclaimed,
            netEnergy,
            netBandwidth,
            transactionCount: transactions.length
        });

        logger.debug('Emitted WebSocket event for new summation');

    } catch (error) {
        logger.error({ error }, 'Failed to run summation aggregation job');
        throw error;
    }
}
