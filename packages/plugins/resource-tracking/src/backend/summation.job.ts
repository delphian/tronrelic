import type { IPluginDatabase, ISystemLogService, IPluginWebSocketManager } from '@tronrelic/types';
import type { IDelegationTransaction, ISummationData, IResourceTrackingConfig, IAggregationState } from '../shared/types/index.js';

/**
 * Aggregate delegation transaction data into summation records using block-based windows.
 *
 * This job operates on fixed block ranges (default 300 blocks ≈ 5 minutes at 3-second blocks)
 * instead of time-based intervals. Block-based aggregation provides deterministic, verifiable
 * summaries that align with blockchain's natural progression unit.
 *
 * The job maintains a persistent cursor (lastProcessedBlock) and calculates the next block
 * range to process based on the configurable blocksPerInterval setting. Before processing,
 * it verifies that block N+1 exists to ensure all blocks in the target range are fully indexed
 * and no transactions are missing.
 *
 * When the job detects it's fallen behind (blockchain sync is ahead), it processes up to
 * 3 tranches per run to catch up faster while still maintaining verification for each tranche.
 *
 * Key benefits over time-based aggregation:
 * - Deterministic: Reprocessing blocks 1000-1299 always produces identical results
 * - Verifiable: Each summation declares exact block ranges for audit trails
 * - Replayable: Can backfill or reprocess historical block ranges accurately
 * - Resilient: Waits for blockchain sync instead of creating incomplete summations
 * - Catch-up capable: Processes multiple tranches when behind
 *
 * @param database - Plugin-scoped database service for reading transactions and writing summations
 * @param logger - Scoped logger for job execution tracking
 * @param websocket - Plugin WebSocket manager for emitting real-time events to subscribed clients
 */
export async function runSummationJob(
    database: IPluginDatabase,
    logger: ISystemLogService,
    websocket: IPluginWebSocketManager
): Promise<void> {
    const jobStartTime = new Date();
    const MAX_TRANCHES_PER_RUN = 3;

    try {
        // Step 1: Load persistent aggregation state
        let state = await database.get<IAggregationState>('aggregation-state');

        // Initialize state if first run
        if (!state) {
            // Find the earliest block in transactions collection
            const earliestTxs = await database.find<IDelegationTransaction>(
                'transactions',
                {},
                { sort: { blockNumber: 1 }, limit: 1 }
            );

            if (earliestTxs.length === 0) {
                logger.info('No transactions found - waiting for blockchain sync to populate data');
                return;
            }

            const initialBlock = earliestTxs[0].blockNumber;
            state = {
                lastProcessedBlock: initialBlock - 1, // Start before first transaction
                lastAggregationTime: new Date()
            };

            await database.set('aggregation-state', state);
            logger.info(
                { initialBlock, lastProcessedBlock: state.lastProcessedBlock },
                'Initialized block aggregation state'
            );
            return; // Wait for next run to process first range
        }

        // Step 2: Load configuration to get blocks per interval
        const config = await database.get<IResourceTrackingConfig>('config');
        if (!config) {
            logger.warn('No configuration found - cannot determine blocksPerInterval');
            return;
        }

        const blocksPerInterval = config.blocksPerInterval;

        // Step 3: Process up to MAX_TRANCHES_PER_RUN tranches
        let tranchesProcessed = 0;

        for (let tranche = 0; tranche < MAX_TRANCHES_PER_RUN; tranche++) {
            // Reload state to get updated lastProcessedBlock from previous iteration
            state = await database.get<IAggregationState>('aggregation-state');
            if (!state) {
                logger.error('Aggregation state disappeared during job execution');
                return;
            }

            // Calculate target block range
            const startBlock = state.lastProcessedBlock + 1;
            const endBlock = startBlock + blocksPerInterval - 1;

            logger.info(
                {
                    tranche: tranche + 1,
                    maxTranches: MAX_TRANCHES_PER_RUN,
                    lastProcessedBlock: state.lastProcessedBlock,
                    startBlock,
                    endBlock,
                    blocksPerInterval,
                    rangeSize: endBlock - startBlock + 1
                },
                'Calculated block range for tranche'
            );

            // Verify N+1 block exists (ensures all blocks in range are fully indexed)
            // Check the highest block number in our transactions collection, regardless of
            // whether that specific block contains delegation transactions
            const verificationBlock = endBlock + 1;
            const latestTxs = await database.find<IDelegationTransaction>(
                'transactions',
                {},
                { sort: { blockNumber: -1 }, limit: 1 }
            );

            const latestIndexedBlock = latestTxs[0]?.blockNumber ?? 0;

            if (latestIndexedBlock < verificationBlock) {
                logger.info(
                    {
                        tranche: tranche + 1,
                        tranchesProcessed,
                        targetRange: [startBlock, endBlock],
                        verificationBlock,
                        latestIndexedBlock,
                        blocksBehind: verificationBlock - latestIndexedBlock
                    },
                    'Block N+1 not indexed yet - stopping tranche processing'
                );
                break; // Stop processing tranches, blockchain sync needs to catch up
            }

            // Query all transactions in block range
            const transactions = await database.find<IDelegationTransaction>(
                'transactions',
                {
                    blockNumber: { $gte: startBlock, $lte: endBlock }
                },
                { sort: { blockNumber: 1, timestamp: 1 } }
            );

            // Warn if no transactions found - delegation activity is normally constant on TRON
            if (transactions.length === 0) {
                logger.warn(
                    {
                        tranche: tranche + 1,
                        startBlock,
                        endBlock,
                        transactionCount: 0,
                        rangeSize: endBlock - startBlock + 1
                    },
                    'No delegation transactions found in block range - delegation observer may not be capturing transactions'
                );
            } else {
                logger.info(
                    {
                        tranche: tranche + 1,
                        startBlock,
                        endBlock,
                        transactionCount: transactions.length
                    },
                    'Retrieved transactions for block range'
                );
            }

            // Determine timestamp from first transaction in the starting block
            // If no transactions exist in range, use current time as fallback
            let summationTimestamp = new Date();
            if (transactions.length > 0) {
                const firstTransaction = transactions.find(tx => tx.blockNumber === startBlock);
                if (firstTransaction) {
                    summationTimestamp = firstTransaction.timestamp;
                }
            }

            // Aggregate by resource type and count transaction types
            let energyDelegated = 0;
            let energyReclaimed = 0;
            let bandwidthDelegated = 0;
            let bandwidthReclaimed = 0;
            let totalTransactionsDelegated = 0;
            let totalTransactionsUndelegated = 0;

            for (const tx of transactions) {
                const amount = Math.abs(tx.amountSun); // Use absolute value for sums
                const isDelegation = tx.amountSun > 0;

                // Count transaction types
                if (isDelegation) {
                    totalTransactionsDelegated++;
                } else {
                    totalTransactionsUndelegated++;
                }

                // Aggregate amounts by resource type
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
            const totalTransactionsNet = totalTransactionsDelegated - totalTransactionsUndelegated;

            // Create summation record with block range
            const summation: Omit<ISummationData, 'createdAt'> = {
                timestamp: summationTimestamp, // Use timestamp from first transaction in starting block
                startBlock,
                endBlock,
                energyDelegated,
                energyReclaimed,
                bandwidthDelegated,
                bandwidthReclaimed,
                netEnergy,
                netBandwidth,
                transactionCount: transactions.length,
                totalTransactionsDelegated,
                totalTransactionsUndelegated,
                totalTransactionsNet
            };

            await database.insertOne('summations', summation);

            // Update state cursor
            const updatedState: IAggregationState = {
                lastProcessedBlock: endBlock,
                lastAggregationTime: new Date()
            };

            await database.set('aggregation-state', updatedState);

            tranchesProcessed++;

            logger.info(
                {
                    tranche: tranche + 1,
                    startBlock,
                    endBlock,
                    transactionCount: transactions.length,
                    energyDelegated,
                    energyReclaimed,
                    netEnergy,
                    bandwidthDelegated,
                    bandwidthReclaimed,
                    netBandwidth,
                    totalTransactionsDelegated,
                    totalTransactionsUndelegated,
                    totalTransactionsNet,
                    lastProcessedBlock: endBlock
                },
                'Block-based summation tranche completed'
            );

            // Emit WebSocket event to notify subscribed clients
            // Convert SUN to millions of TRX to match API response format
            // 1 TRX = 1,000,000 SUN, so 1M TRX = 1,000,000,000,000 SUN (1e12)
            websocket.emitToRoom('summation-updates', 'summation-created', {
                timestamp: summation.timestamp.toISOString(),
                startBlock,
                endBlock,
                energyDelegated: Number((energyDelegated / 1e12).toFixed(1)),
                energyReclaimed: Number((energyReclaimed / 1e12).toFixed(1)),
                bandwidthDelegated: Number((bandwidthDelegated / 1e12).toFixed(1)),
                bandwidthReclaimed: Number((bandwidthReclaimed / 1e12).toFixed(1)),
                netEnergy: Number((netEnergy / 1e12).toFixed(1)),
                netBandwidth: Number((netBandwidth / 1e12).toFixed(1)),
                transactionCount: transactions.length,
                totalTransactionsDelegated,
                totalTransactionsUndelegated,
                totalTransactionsNet
            });

            logger.info(
                {
                    tranche: tranche + 1,
                    startBlock,
                    endBlock,
                    transactionCount: transactions.length
                },
                'Emitted WebSocket event for tranche'
            );
        }

        // Final summary
        logger.info(
            {
                tranchesProcessed,
                maxTranches: MAX_TRANCHES_PER_RUN,
                durationMs: Date.now() - jobStartTime.getTime()
            },
            'Summation job completed'
        );

    } catch (error) {
        logger.error(
            {
                error,
                jobStartedAt: jobStartTime.toISOString(),
                durationMs: Date.now() - jobStartTime.getTime()
            },
            'Failed to run block-based summation aggregation job'
        );
        throw error;
    }
}
