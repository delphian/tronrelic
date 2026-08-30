import { randomUUID } from 'node:crypto';
import type { AnyBulkWriteOperation } from 'mongoose';
import type { Redis as RedisClient } from 'ioredis';
import type { TronTransactionDocument } from '@/shared';
import type { ITransaction, ITransactionPersistencePayload, ITransactionCategoryFlags, IDatabaseService, IBlockchainService, IActivatingTransaction, IActivationAncestry, ActivationClimbStopReason, IActivationClimbOptions, IBlockData } from '@/types';
import { ProcessedTransaction } from '@/types';
import { TransactionModel, type TransactionDoc, type TransactionFields } from '../../database/models/transaction-model.js';
import { SyncStateModel, type SyncStateDoc, type SyncStateFields } from '../../database/models/sync-state-model.js';
import { resolveCursorBlock, resolveCachedHead } from './chain-head.js';
import { BlockModel, type BlockDoc, type BlockStats, type BlockFields } from '../../database/models/block-model.js';
import { CORE_NETWORK_ACTIVITY_ROLLUPS_COLLECTION, type CoreNetworkActivityRollupFields } from '../../database/models/core-network-activity-rollup-model.js';
import { DelegationFlowModel, ContractActivityModel, TokenModel } from '../../database/models/index.js';
import { QueueService } from '../../services/queue.service.js';
import { blockchainConfig } from '../../config/blockchain.js';
import { TronGridClient, type TronGridBlock, type TronGridTransaction, type TronGridTransactionInfo } from './tron-grid.client.js';
import { normalizeContractType, resolveOwnerAddress, resolveRecipient, resolveAmounts, describeContract } from './transaction-parse.js';
import { resolveCaughtUpMode } from './sync-mode.js';
import { resolveBlockAgeInBlocks } from './block-pacer.js';
import { BlockEmitter, type IBlockNewPayload, type IPreparedBlock } from './block-emitter.js';
import { BlockCommitter, type IBlockCommitMetrics } from './block-committer.js';
import { WebSocketService } from '../../services/websocket.service.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../config/env.js';
import { getRedisClient } from '../../loaders/redis.js';
import { AlertService } from '../../services/alert.service.js';
import { PriceService } from '../../services/price.service.js';
import { AddressInsightService } from '../../services/address-insight.service.js';
import { BlockchainObserverService } from '../../services/blockchain-observer/index.js';
import { ProviderConfigService } from '../providers/services/provider-config.service.js';

/**
 * Job data for queuing individual block processing tasks.
 * Each job represents a single blockchain block that needs to be fetched, parsed, and persisted.
 */
interface BlockSyncJob {
    blockNumber: number;
    isCaughtUp: boolean;
}

/**
 * The chain height a sync tick schedules against, and where it came from.
 *
 * The two are reported together because a height read from a previous tick is
 * usable for scheduling but must not be treated as current: the lag figures
 * derived from it understate reality, and the tick should not clear the error
 * state that says the head lookup is failing.
 */
interface IChainHead {
    /** Height to use as this tick's ceiling for the forward walk. */
    blockNumber: number;
    /** True when the live lookup failed and a previously recorded height was used. */
    fromCache: boolean;
}

// Re-export types from @/types for backward compatibility
export type TransactionCategoryFlags = ITransactionCategoryFlags;
export type TransactionPersistencePayload = ITransactionPersistencePayload;
// ProcessedTransaction is now a class, imported directly from @/types

/**
 * Default hop cap for {@link BlockchainService.climbActivationAncestry}. A chain
 * this deep effectively never traces a single operator's own wallets — it runs
 * into exchange/genesis history — and the cap bounds the worst-case TronGrid cost
 * of one climb to `MAX_ACTIVATION_ANCESTRY_DEPTH × 2` throttled requests.
 */
export const MAX_ACTIVATION_ANCESTRY_DEPTH = 20;

/**
 * Accumulator for tracking smart contract activity within a block.
 * Used to aggregate multiple calls to the same contract method for analytics purposes.
 */
interface ContractActivityAccumulator {
    contractAddress: string;
    method?: string;
    callers: Set<string>;
    callCount: number;
    totalTRX: number;
    totalUSD: number;
    totalEnergy: number;
    lastActivityAt: Date;
    lastTxId: string;
}

/**
 * Shared context passed through transaction enrichment pipeline.
 * Provides block-level data needed to enrich individual transactions with USD prices.
 */
interface TransactionBuildContext {
    priceUSD: number | null;
    blockTime: Date;
}


type TransactionAddress = TransactionDoc['from'];
type TransactionResource = TransactionDoc['energy'];
type TransactionAnalysis = TransactionDoc['analysis'];

/**
 * Blockchain synchronization and transaction processing service.
 *
 * This service orchestrates the continuous ingestion of TRON blockchain data by fetching blocks from TronGrid,
 * enriching transactions with USD pricing and address insights, and persisting everything to MongoDB. It uses
 * a BullMQ job queue to ensure serial block processing with proper rate limiting and error recovery, preventing
 * API overload while maintaining data integrity. The service also notifies observers via the observer registry
 * so plugins can react to specific transaction types without coupling to the core sync logic.
 *
 * Database access pattern:
 * Uses IDatabaseService for all MongoDB operations, enabling testability through mock implementations.
 * Models are registered for Mongoose schema validation and accessed via getModel() for complex operations.
 */
export class BlockchainService implements IBlockchainService {
    private static instance: BlockchainService | null = null;
    private static database: IDatabaseService | null = null;

    // Collection names for database operations
    private static readonly TRANSACTIONS_COLLECTION = 'transactions';
    private static readonly SYNC_STATE_COLLECTION = 'sync_states';
    private static readonly BLOCKS_COLLECTION = 'blocks';

    private readonly redis: RedisClient;
    private readonly queue: QueueService<BlockSyncJob>;
    private readonly tronClient = TronGridClient.getInstance();
    private readonly lockToken = randomUUID();
    private readonly alerts: AlertService;
    private readonly priceService = PriceService.getInstance();
    private readonly addressInsights = new AddressInsightService();
    private readonly observerService = BlockchainObserverService.getInstance();
    private wasCaughtUp: boolean | null = null;

    /**
     * The backend playout buffer that spaces block announcements.
     *
     * The worker used to hold each block for its own three-second slot before
     * broadcasting it. Because the worker processes one job at a time, that
     * wait blocked the next fetch, so the pipeline never held a fetched block
     * in reserve and any upstream hiccup showed up as a gap in the feed.
     * Ingestion now runs flat out and hands finished blocks here, where a lead
     * of real blocks is kept and released on a separate clock. Releasing one
     * means announcing it to observers, alerts, and connected clients together.
     * See `block-emitter.ts` and `block-announcer.ts`.
     */
    private readonly emitter = BlockEmitter.getInstance();

    /**
     * Writes each released block and tells everything about it.
     *
     * Held as a field so `/system` can report its backlog. That backlog is the
     * one failure this arrangement can produce which the emitter's own metrics
     * cannot show: the emitter reports how many blocks are waiting for a slot,
     * and this reports how many were given a slot and are still being written.
     */
    private readonly committer: BlockCommitter;

    /**
     * The pacing mode of the most recently processed block, kept separate from
     * `wasCaughtUp` because the two answer different questions. `wasCaughtUp`
     * is the scheduler's view once per tick; this is the worker's view per
     * block, which is what actually decides whether a block is paced. Null
     * before the first block, when the scheduler's view is used as the seed.
     */
    private blockPacingCaughtUp: boolean | null = null;

    /**
     * Initialize the blockchain service with required dependencies and configure the block processing queue.
     *
     * This private constructor ensures singleton usage through getInstance(). It sets up a BullMQ worker that processes one block at a time
     * with a 2-minute lock duration to handle transaction-heavy blocks, delegates retry logic entirely to the TronGrid client to avoid
     * double-retry overhead, and configures job cleanup to prevent unbounded Redis memory growth from completed jobs.
     *
     * It also builds the committer and installs it on the emitter. That has to
     * happen here rather than through the emitter's own constructor:
     * `this.emitter` is a field initializer, so it resolves before this body
     * runs, and the committer needs the alert service created two lines below.
     */
    private constructor() {
        const database = BlockchainService.getDatabase();
        this.redis = getRedisClient();
        this.alerts = new AlertService(database, this.tronClient);

        this.committer = new BlockCommitter({
            persist: prepared => this.persistPreparedBlock(prepared),
            observers: this.observerService,
            alerts: this.alerts,
            broadcast: payload => WebSocketService.getInstance().emit({ event: 'block:new', payload })
        });
        BlockEmitter.setCommitSink(this.committer);

        this.queue = new QueueService<BlockSyncJob>(
            'block-sync',
            async job => {
                await this.processBlock(job.data.blockNumber, job.data.isCaughtUp);
            },
            {
                // No retry at job level - TronGrid client handles retries (6 attempts with 1s, 2s, 4s, 8s, 16s, 32s backoff)
                defaultJobOptions: {
                    attempts: 1, // Single attempt - let TronGrid client handle all retries
                    removeOnComplete: 1000,
                    removeOnFail: true // Remove failed jobs immediately - they're already exhausted
                }
            },
            {
                // Lock duration needs to be long enough for blocks with many transactions
                // With 200ms rate limiting + 6 retries with exponential backoff, worst case ~63 seconds of retries
                lockDuration: 120000 // 2 minutes
                // Worker processes one job at a time by default (concurrency: 1)
            }
        );
    }

    /**
     * Set dependencies for the service singleton.
     *
     * Must be called before getInstance() to inject the database service.
     * Typically called during application bootstrap in index.ts.
     *
     * @param database - Database service for MongoDB operations
     */
    public static setDependencies(database: IDatabaseService): void {
        BlockchainService.database = database;

        // Register Mongoose models for schema validation and query building
        database.registerModel(BlockchainService.TRANSACTIONS_COLLECTION, TransactionModel);
        database.registerModel(BlockchainService.SYNC_STATE_COLLECTION, SyncStateModel);
        database.registerModel(BlockchainService.BLOCKS_COLLECTION, BlockModel);
    }

    /**
     * Get the singleton instance of the blockchain service.
     * Creates the service on first access and reuses it for all subsequent calls, ensuring a single job queue and observer registry across the application.
     */
    static getInstance() {
        if (!BlockchainService.instance) {
            BlockchainService.instance = new BlockchainService();
        }
        return BlockchainService.instance;
    }


    /**
     * Get the database service, throwing if not initialized.
     *
     * @returns IDatabaseService instance
     * @throws Error if setDependencies() has not been called
     */
    private static getDatabase(): IDatabaseService {
        if (!BlockchainService.database) {
            throw new Error('BlockchainService.setDependencies() must be called before using the service');
        }
        return BlockchainService.database;
    }

    /**
     * Mark a block for temporary cooldown after exhausting retry attempts.
     *
     * Failed blocks enter a 5-minute cooldown period to prevent immediate re-queueing that would waste API quota. The block remains
     * in the backfill queue for eventual retry once the cooldown expires, giving transient network issues time to resolve while
     * allowing the sync process to move forward with other blocks.
     */
    private async markBlockFailed(blockNumber: number) {
        const key = `${env.REDIS_NAMESPACE}:block-sync:cooldown:${blockNumber}`;
        const cooldownSeconds = 5 * 60; // 5 minutes
        await this.redis.setex(key, cooldownSeconds, Date.now().toString());
        logger.warn({ blockNumber, cooldownMinutes: 5 }, 'Block marked for cooldown after exhausting retries');
    }

    /**
     * Check if a block is currently in cooldown after a recent failure.
     * Returns true if the block failed within the last 5 minutes, preventing wasteful retry attempts before the cooldown expires.
     */
    private async isBlockInCooldown(blockNumber: number): Promise<boolean> {
        const key = `${env.REDIS_NAMESPACE}:block-sync:cooldown:${blockNumber}`;
        const value = await this.redis.get(key);
        return value !== null;
    }

    /**
     * Retrieve the most recent transactions from the database.
     * Useful for API endpoints that display recent blockchain activity, sorted by timestamp descending to show newest first.
     */
    async getLatestTransactions(limit = 50): Promise<TransactionFields[]> {
        const model = BlockchainService.getDatabase().getModel<TransactionDoc>(BlockchainService.TRANSACTIONS_COLLECTION);
        return model.find().sort({ timestamp: -1 }).limit(limit).lean() as Promise<TransactionFields[]>;
    }

    /**
     * Retrieve the most recently processed block from the database.
     * Returns block summary with transaction count and statistics for SSR rendering.
     * Returns null if no blocks have been processed yet.
     */
    async getLatestBlock(): Promise<BlockFields | null> {
        const model = BlockchainService.getDatabase().getModel<BlockDoc>(BlockchainService.BLOCKS_COLLECTION);
        return model.findOne().sort({ blockNumber: -1 }).lean() as Promise<BlockFields | null>;
    }

    /**
     * Prune old transactions from the database to prevent unbounded growth.
     *
     * This method removes transactions older than the retention period (default 4 days) to keep the
     * working set — and especially the random-key txId/address indexes — small enough that bulk
     * writes stay cache-resident rather than faulting cold B-tree pages from disk.
     * It deletes transactions in 2-hour batches to avoid long-running operations that could block other queries.
     * The pruning is conservative - only transactions older than the retention period are eligible for deletion.
     *
     * Retention is coupled to `TARGET_HOURLY_BUCKETS` in overview-rollup.job.ts: the rollup backfill
     * must never reach past this cutoff, or it fabricates zero-volume buckets from pruned hours.
     * Shorten retention only in lockstep with that constant.
     *
     * @param retentionHours - Number of hours to retain transactions (default: 96 = 4 days)
     * @param batchHours - Number of hours of old transactions to delete per run (default: 2)
     * @returns Object containing number of transactions deleted and the oldest remaining transaction timestamp
     */
    async pruneOldTransactions(retentionHours = 96, batchHours = 2): Promise<{ deletedCount: number; oldestRemaining: Date | null }> {
        const retentionMs = retentionHours * 60 * 60 * 1000;
        const batchMs = batchHours * 60 * 60 * 1000;
        const cutoffDate = new Date(Date.now() - retentionMs);

        const txModel = BlockchainService.getDatabase().getModel<TransactionDoc>(BlockchainService.TRANSACTIONS_COLLECTION);

        // Find the oldest transaction timestamp
        const oldestDoc = await txModel.findOne({}, { timestamp: 1 })
            .sort({ timestamp: 1 })
            .lean() as TransactionFields | null;

        if (!oldestDoc) {
            logger.debug('No transactions found for pruning');
            return { deletedCount: 0, oldestRemaining: null };
        }

        const oldestTimestamp = oldestDoc.timestamp;

        // Only prune if there are transactions older than the retention period
        if (oldestTimestamp >= cutoffDate) {
            logger.debug({ oldestTimestamp, cutoffDate, retentionHours }, 'No transactions old enough to prune');
            return { deletedCount: 0, oldestRemaining: oldestTimestamp };
        }

        // Calculate the batch cutoff: delete up to batchHours worth of old transactions
        // Start from the oldest timestamp and go forward batchHours
        const batchCutoff = new Date(oldestTimestamp.getTime() + batchMs);

        // Delete transactions older than cutoffDate AND within the batch window
        const result = await txModel.deleteMany({
            timestamp: {
                $lt: Math.min(batchCutoff.getTime(), cutoffDate.getTime())
            }
        });

        const deletedCount = result.deletedCount ?? 0;

        // Find the new oldest transaction
        const newOldestDoc = await txModel.findOne({}, { timestamp: 1 })
            .sort({ timestamp: 1 })
            .lean() as TransactionFields | null;

        const oldestRemaining = newOldestDoc?.timestamp ?? null;

        logger.info({
            deletedCount,
            retentionHours,
            batchHours,
            cutoffDate,
            batchCutoff,
            oldestRemaining
        }, 'Pruned old transactions');

        return { deletedCount, oldestRemaining };
    }

    /**
     * Prune old blocks from the database to prevent unbounded growth.
     *
     * Without pruning the blocks collection grows forever (~28,800 documents per day) and
     * its data plus indexes crowd the WiredTiger cache. Blocks use a longer retention than
     * transactions because each block document carries its own aggregate stats, which stay
     * useful for charting after the underlying transactions have been pruned — the
     * transaction-timeseries endpoint reads exactly this window.
     *
     * Mirrors pruneOldTransactions: deletes at most `batchHours` worth of the oldest blocks
     * per invocation so a large backlog drains gradually across scheduled runs instead of
     * one long-running delete. The default batch is larger than the transaction prune's
     * because block documents are far smaller and cheaper to delete.
     *
     * @param requestedRetentionHours - Hours of block history to keep; defaults to the configured
     *   block retention window, and is floored at one hour before use
     * @param requestedBatchHours - Maximum hours-worth of oldest blocks deleted per invocation,
     *   bounding each run's work; also floored at one hour
     * @returns Count of blocks deleted and the timestamp of the oldest remaining block
     */
    async pruneOldBlocks(
        requestedRetentionHours = blockchainConfig.retention.blockHours,
        requestedBatchHours = 24
    ): Promise<{ deletedCount: number; oldestRemaining: Date | null }> {
        // Floor both windows at one hour. The retention default is read straight from
        // BLOCKCHAIN_RETENTION_BLOCK_HOURS, which is only checked for finiteness, so a zero or
        // negative value would place the cutoff at or beyond the present and turn this job into
        // a slow drain of the entire collection. A non-positive batch is the opposite failure:
        // it would prune nothing at all while still reporting success.
        const retentionHours = Math.max(1, requestedRetentionHours);
        const batchHours = Math.max(1, requestedBatchHours);
        const retentionMs = retentionHours * 60 * 60 * 1000;
        const batchMs = batchHours * 60 * 60 * 1000;
        const cutoffDate = new Date(Date.now() - retentionMs);

        const blockModel = BlockchainService.getDatabase().getModel<BlockDoc>(BlockchainService.BLOCKS_COLLECTION);

        // Find the oldest block timestamp
        const oldestDoc = await blockModel.findOne({}, { timestamp: 1 })
            .sort({ timestamp: 1 })
            .lean() as BlockFields | null;

        if (!oldestDoc) {
            logger.debug('No blocks found for pruning');
            return { deletedCount: 0, oldestRemaining: null };
        }

        const oldestTimestamp = oldestDoc.timestamp;

        // Only prune if there are blocks older than the retention period
        if (oldestTimestamp >= cutoffDate) {
            logger.debug({ oldestTimestamp, cutoffDate, retentionHours }, 'No blocks old enough to prune');
            return { deletedCount: 0, oldestRemaining: oldestTimestamp };
        }

        // Delete blocks older than cutoffDate AND within the batch window
        const batchCutoff = new Date(oldestTimestamp.getTime() + batchMs);

        const result = await blockModel.deleteMany({
            timestamp: {
                $lt: new Date(Math.min(batchCutoff.getTime(), cutoffDate.getTime()))
            }
        });

        const deletedCount = result.deletedCount ?? 0;

        // Find the new oldest block
        const newOldestDoc = await blockModel.findOne({}, { timestamp: 1 })
            .sort({ timestamp: 1 })
            .lean() as BlockFields | null;

        const oldestRemaining = newOldestDoc?.timestamp ?? null;

        logger.info({
            deletedCount,
            retentionHours,
            batchHours,
            cutoffDate,
            batchCutoff,
            oldestRemaining
        }, 'Pruned old blocks');

        return { deletedCount, oldestRemaining };
    }

    /**
     * Retrieve transaction count timeseries data grouped by time windows.
     *
     * Aggregates historical block data from MongoDB to produce time-windowed transaction statistics
     * for charting purposes. The grouping granularity automatically adjusts based on the requested
     * time range to balance data resolution with response size:
     * - 1 day: 30-minute buckets (48 points)
     * - 7 days: hourly buckets (168 points)
     * - 30 days: 4-hour windows (180 points)
     *
     * Each data point includes:
     * - Total transactions in that time window (sum across blocks)
     * - Average transactions per block in that window
     *
     * @param days - Number of days of history to retrieve (min 1; clamped to the configured
     *   block retention window, 32 days by default — the blocks backing this series are
     *   pruned beyond that window, so larger values would silently return truncated data)
     * @returns Array of timeseries points sorted chronologically
     * @throws ValidationError if days parameter is invalid
     */
    async getTransactionTimeseries(days: number) {
        if (!Number.isFinite(days) || days <= 0) {
            throw new Error('Days must be a positive number');
        }

        // Clamp to the block retention window: blocks older than this are pruned,
        // so a wider range would only zero-pad the series.
        const maxDays = Math.max(1, Math.floor(blockchainConfig.retention.blockHours / 24));
        const clampedDays = Math.min(Math.max(days, 1), maxDays);
        const startDate = new Date(Date.now() - clampedDays * 24 * 60 * 60 * 1000);

        // Determine grouping format based on time range
        let dateFormat: string;
        let use30MinBuckets = false;
        if (clampedDays <= 1) {
            // 1 day: group by 30 minutes (48 points)
            dateFormat = '%Y-%m-%d %H:00';
            use30MinBuckets = true;
        } else if (clampedDays <= 7) {
            // 7 days: group by hour (168 points)
            dateFormat = '%Y-%m-%d %H:00';
        } else {
            // 30+ days: group by 4-hour windows (6 buckets per day)
            // Use hour modulo to create 4-hour buckets: 00-03, 04-07, 08-11, 12-15, 16-19, 20-23
            dateFormat = '%Y-%m-%d';
        }

        interface AggregationResult {
            _id: string;
            hour?: number;
            transactions: number;
            avgPerBlock: number;
            blockCount: number;
        }

        const pipeline: object[] = [
            {
                $match: {
                    timestamp: { $gte: startDate }
                }
            }
        ];

        if (clampedDays > 7) {
            // For 30+ days, add hour field and round to 4-hour buckets
            pipeline.push(
                {
                    $addFields: {
                        hour: { $hour: '$timestamp' },
                        dateOnly: { $dateToString: { format: dateFormat, date: '$timestamp' } }
                    }
                },
                {
                    $addFields: {
                        hourBucket: {
                            $multiply: [
                                { $floor: { $divide: ['$hour', 4] } },
                                4
                            ]
                        }
                    }
                },
                {
                    $group: {
                        _id: {
                            date: '$dateOnly',
                            bucket: '$hourBucket'
                        },
                        transactions: { $sum: '$transactionCount' },
                        blockCount: { $sum: 1 }
                    }
                },
                {
                    $project: {
                        _id: {
                            $concat: [
                                { $toString: '$_id.date' },
                                ' ',
                                {
                                    $cond: [
                                        { $lt: ['$_id.bucket', 10] },
                                        { $concat: ['0', { $toString: '$_id.bucket' }] },
                                        { $toString: '$_id.bucket' }
                                    ]
                                },
                                ':00'
                            ]
                        },
                        transactions: 1,
                        blockCount: 1,
                        avgPerBlock: {
                            $cond: [
                                { $gt: ['$blockCount', 0] },
                                { $divide: ['$transactions', '$blockCount'] },
                                0
                            ]
                        }
                    }
                }
            );
        } else if (use30MinBuckets) {
            // For 1 day, group by 30-minute buckets
            pipeline.push(
                {
                    $addFields: {
                        hour: { $hour: '$timestamp' },
                        minute: { $minute: '$timestamp' },
                        dateOnly: { $dateToString: { format: dateFormat, date: '$timestamp' } }
                    }
                },
                {
                    $addFields: {
                        minuteBucket: {
                            $multiply: [
                                { $floor: { $divide: ['$minute', 30] } },
                                30
                            ]
                        }
                    }
                },
                {
                    $group: {
                        _id: {
                            date: '$dateOnly',
                            hour: '$hour',
                            bucket: '$minuteBucket'
                        },
                        transactions: { $sum: '$transactionCount' },
                        blockCount: { $sum: 1 }
                    }
                },
                {
                    $project: {
                        _id: {
                            $concat: [
                                { $substr: [{ $toString: '$_id.date' }, 0, 10] },
                                ' ',
                                {
                                    $cond: [
                                        { $lt: ['$_id.hour', 10] },
                                        { $concat: ['0', { $toString: '$_id.hour' }] },
                                        { $toString: '$_id.hour' }
                                    ]
                                },
                                ':',
                                {
                                    $cond: [
                                        { $lt: ['$_id.bucket', 10] },
                                        { $concat: ['0', { $toString: '$_id.bucket' }] },
                                        { $toString: '$_id.bucket' }
                                    ]
                                }
                            ]
                        },
                        transactions: 1,
                        blockCount: 1,
                        avgPerBlock: {
                            $cond: [
                                { $gt: ['$blockCount', 0] },
                                { $divide: ['$transactions', '$blockCount'] },
                                0
                            ]
                        }
                    }
                }
            );
        } else {
            // For 2-7 days, group by hour directly
            pipeline.push(
                {
                    $group: {
                        _id: { $dateToString: { format: dateFormat, date: '$timestamp' } },
                        transactions: { $sum: '$transactionCount' },
                        blockCount: { $sum: 1 }
                    }
                },
                {
                    $project: {
                        _id: 1,
                        transactions: 1,
                        blockCount: 1,
                        avgPerBlock: {
                            $cond: [
                                { $gt: ['$blockCount', 0] },
                                { $divide: ['$transactions', '$blockCount'] },
                                0
                            ]
                        }
                    }
                }
            );
        }

        pipeline.push({ $sort: { _id: 1 } });

        const blocksCollection = BlockchainService.getDatabase().getCollection<BlockDoc>(BlockchainService.BLOCKS_COLLECTION);
        const results = await blocksCollection.aggregate<AggregationResult>(pipeline).toArray();

        return results.map((row: AggregationResult) => {
            // Parse the date string and convert to ISO format with UTC timezone
            // MongoDB returns strings like "2025-10-13 01:00" without timezone info
            // We interpret these as UTC and convert to proper ISO 8601 format
            let isoDate: string;
            try {
                // Append 'Z' to indicate UTC timezone, then convert to ISO string
                const parsedDate = new Date(row._id + ':00Z');
                if (isNaN(parsedDate.getTime())) {
                    throw new Error('Invalid date');
                }
                isoDate = parsedDate.toISOString();
            } catch {
                // Fallback to original value if parsing fails
                isoDate = row._id;
            }

            return {
                date: isoDate,
                transactions: row.transactions,
                avgPerBlock: Number(row.avgPerBlock.toFixed(1))
            };
        });
    }

    /**
     * Read the pre-computed network-activity overview series for a window.
     *
     * Backs the core `core:network-activity` widget — transactions, native
     * transfers, and native TRX transfer volume per bucket. The series is
     * pre-aggregated by the `network-activity:rollup` scheduler job into the
     * `core_network_activity_rollups` collection (see {@link runOverviewRollup}),
     * so this read is a bounded fetch of at most 168 small documents rather than
     * a live aggregation over the multi-million-row transactions collection.
     * That live aggregation previously exceeded the SSR widget resolver's
     * 5-second budget, so the resolver silently dropped the widget from the page;
     * reading pre-baked buckets keeps the request well inside the budget.
     *
     * Results anchor on the latest stored bucket (sort descending, take N, then
     * reverse to chronological), so the series stays correct even when sync lags.
     *
     * @param window - `1h` (minute buckets, 60 points) or `24h`/`7d` (hourly
     *   buckets, 24/168 points). Matches the widget's window toggle.
     * @returns Buckets sorted chronologically; each carries all three metrics.
     */
    async getOverviewTimeseries(window: '1h' | '24h' | '7d') {
        const WINDOW_SPECS: Record<'1h' | '24h' | '7d', { bucketType: 'minute' | 'hourly'; count: number }> = {
            '1h': { bucketType: 'minute', count: 60 },
            '24h': { bucketType: 'hourly', count: 24 },
            '7d': { bucketType: 'hourly', count: 168 }
        };
        const spec = WINDOW_SPECS[window];
        if (!spec) {
            throw new Error(`getOverviewTimeseries: unsupported window '${window}'`);
        }

        const rollups = BlockchainService.getDatabase().getCollection<CoreNetworkActivityRollupFields>(
            CORE_NETWORK_ACTIVITY_ROLLUPS_COLLECTION
        );
        const rows = await rollups
            .find({ bucketType: spec.bucketType })
            .sort({ bucketStart: -1 })
            .limit(spec.count)
            .toArray();

        // The read is newest-first (descending bucketStart); reverse to ascending
        // chronological order for the chart.
        return rows
            .reverse()
            .map((row) => ({
                date: (row.bucketStart instanceof Date ? row.bucketStart : new Date(row.bucketStart)).toISOString(),
                transactions: row.transactions ?? 0,
                transfers: row.transfers ?? 0,
                volume: row.volume ?? 0
            }));
    }

    /**
     * Resolve the account that activated `base58Address` via live TronGrid
     * lookups.
     *
     * This is the one non-DB read on the service: it delegates to the internal
     * TronGrid client so plugins get activation-ancestry resolution without a
     * direct dependency on the (unpublished) client. The heavy lifting —
     * fetching the account's oldest transaction, validating it against the
     * account's creation time so an internally-activated account yields null
     * rather than a false edge, and decoding the owner to base58 — lives in the
     * client; this method only exposes it through the published
     * `IBlockchainService` contract. Because a call costs up to two throttled
     * TronGrid requests, a caller climbing a chain must stay sequential and bound
     * its depth.
     *
     * @param base58Address - Account whose activator to resolve, base58 format.
     * @returns The activating edge, or null when the account has no transactions
     *   or its activator is not resolvable from the top-level feed.
     */
    async getActivatingTransaction(base58Address: string): Promise<IActivatingTransaction | null> {
        return this.tronClient.getActivatingTransaction(base58Address);
    }

    /**
     * Climb the activation ancestry of an address toward its origin, resolving one
     * activator per hop via {@link getActivatingTransaction}.
     *
     * Why this lives here: the bounded loop — cap, cycle guard, per-hop streaming,
     * and shared-tail caching — was previously re-implemented per caller (the
     * address-origins tool, plugin discovery-provenance). Centralizing it on the
     * published service keeps the one tricky piece (a mis-bounded climb silently
     * misreports every address as its own origin) correct in a single place.
     *
     * How it stops: every ending is reported through `stopReason` — a `null` edge
     * is `'unresolved'` (no further activator could be attributed, which is *not*
     * proof of a root), the depth cap is `'depth-cap'`, a repeated activator
     * (impossible on chain, but a provider quirk must not loop us) is `'cycle'`,
     * and a thrown provider call is `'provider-error'`, signalling a partial that
     * a retry may extend. The legacy `originReached`/`truncated` booleans are
     * derived from it for existing consumers. Streamed hops (`onHop`) already
     * delivered survive an early stop.
     *
     * @param base58Address - Account whose ancestry to climb, base58 format.
     * @param options - Depth cap, per-hop streaming callback, and shared edge cache
     *   (see {@link IActivationClimbOptions}); a shared cache dedupes tails across a
     *   batch and is how callers spot common ancestors.
     * @returns The collected ancestry with origin/truncated flags.
     */
    async climbActivationAncestry(base58Address: string, options: IActivationClimbOptions = {}): Promise<IActivationAncestry> {
        // Drain the stepped form rather than duplicating the loop: one bounded
        // climb implementation, two shapes.
        const steps = this.climbActivationAncestrySteps(base58Address, options);
        let step = await steps.next();
        while (!step.done) {
            step = await steps.next();
        }
        return step.value;
    }

    /**
     * The same bounded climb, surfaced one hop per `next()` so a caller driving
     * several ladders can interleave them instead of running each to completion.
     *
     * Why a generator rather than a second loop in the caller: everything tricky
     * about this walk — the depth cap, the cycle guard, the shared-edge cache, and
     * the `stopReason` accounting a mis-bounded climb silently corrupts — must
     * exist exactly once, which is why {@link climbActivationAncestry} is now a
     * thin drain of this method instead of a parallel implementation.
     *
     * The shared `edgeCache` holds the in-flight *promise* per child address, not
     * the resolved edge. Interleaved ladders converging on a common ancestor reach
     * it at nearly the same moment, and a resolved-value cache is still empty for
     * the second climber while the first one's request is in flight — so both
     * would fetch, and keep duplicating every remaining call of the shared tail.
     * Awaiting the cached promise collapses that back to one climb's worth of
     * provider traffic. A rejected lookup is evicted so a later climb can retry.
     *
     * @param base58Address - Account whose ancestry to climb, base58 format.
     * @param options - Depth cap, per-hop `onHop` callback (still fired, for the
     *   drained form's streaming consumers), and the batch's shared edge cache.
     * @returns Yields each activator hop as it resolves; returns the collected
     *   ancestry once the climb stops.
     */
    async *climbActivationAncestrySteps(
        base58Address: string,
        options: IActivationClimbOptions = {}
    ): AsyncGenerator<IActivatingTransaction, IActivationAncestry, void> {
        const maxDepth = options.maxDepth ?? MAX_ACTIVATION_ANCESTRY_DEPTH;
        const chain: IActivatingTransaction[] = [];
        const seen = new Set<string>([base58Address]);
        let current = base58Address;
        // Defaults to the depth-cap ending: the loop below overwrites this on every
        // other exit path, so the only way it survives is running the cap out.
        let stopReason: ActivationClimbStopReason = 'depth-cap';

        for (let depth = 0; depth < maxDepth; depth += 1) {
            let edge: IActivatingTransaction | null;
            try {
                // Reuse a shared lookup across a batch when provided — activations
                // are immutable, so a tail common to several addresses is fetched
                // once. The promise is cached before it settles so an interleaved
                // ladder arriving mid-flight joins this request instead of issuing
                // its own; without that, converging ladders duplicate the whole
                // shared tail.
                let lookup = options.edgeCache?.get(current);
                if (!lookup) {
                    lookup = this.getActivatingTransaction(current);
                    options.edgeCache?.set(current, lookup);
                }
                edge = await lookup;
            } catch (error) {
                // Drop the failed lookup so it is not replayed as a permanent
                // failure to every other ladder sharing this cache, nor to a retry.
                options.edgeCache?.delete(current);
                // A throttled TronGrid call failed; stop with whatever streamed so
                // far rather than discarding progress, and say so, so the caller
                // can offer a retry instead of presenting a partial as complete.
                logger.warn(
                    { base58Address, atAddress: current, depth, error: error instanceof Error ? error.message : String(error) },
                    'Activation-ancestry climb interrupted by provider error'
                );
                stopReason = 'provider-error';
                break;
            }

            if (!edge) {
                stopReason = 'unresolved';
                break;
            }

            chain.push(edge);
            options.onHop?.(edge, depth);
            yield edge;

            if (seen.has(edge.activatorAddress)) {
                stopReason = 'cycle';
                break;
            }
            seen.add(edge.activatorAddress);
            current = edge.activatorAddress;
        }

        if (stopReason === 'depth-cap') {
            logger.warn(
                { base58Address, maxDepth },
                'Activation ancestry hit the depth cap before running out of resolvable activators'
            );
        }

        return {
            address: base58Address,
            chain,
            stopReason,
            // Derived, not tracked separately: two sources of truth for one ending
            // is how the original misreport survived. `originReached` keeps its
            // published name but means only "no further activator resolved".
            originReached: stopReason === 'unresolved',
            truncated: stopReason === 'depth-cap'
        };
    }

    /**
     * Count transactions by contract type within a time range.
     *
     * Queries the transactions collection for count matching the specified
     * contract type and timestamp range. Uses the indexed type field for
     * efficient counting.
     *
     * @param contractType - Transaction type (e.g., 'TransferContract', 'TriggerSmartContract')
     * @param start - Start of time range (inclusive)
     * @param end - End of time range (exclusive)
     * @returns Count of matching transactions
     * @throws Error if contractType is empty or dates are invalid
     */
    async countTransactionsByType(contractType: string, start: Date, end: Date): Promise<number> {
        if (typeof contractType !== 'string' || contractType.trim().length === 0) {
            throw new Error('countTransactionsByType: contractType must be a non-empty string');
        }
        if (!(start instanceof Date) || isNaN(start.getTime())) {
            throw new Error('countTransactionsByType: start must be a valid Date');
        }
        if (!(end instanceof Date) || isNaN(end.getTime())) {
            throw new Error('countTransactionsByType: end must be a valid Date');
        }
        if (start.getTime() >= end.getTime()) {
            throw new Error('countTransactionsByType: start must be before end');
        }

        const txModel = BlockchainService.getDatabase().getModel<TransactionDoc>(
            BlockchainService.TRANSACTIONS_COLLECTION
        );

        return txModel.countDocuments({
            type: contractType,
            timestamp: { $gte: start, $lt: end }
        });
    }

    /**
     * Load the current blockchain sync cursor from MongoDB.
     * Returns the last successfully processed block number and backfill queue, or null if this is a fresh install.
     */
    private async getSyncState(): Promise<SyncStateFields | null> {
        const syncModel = BlockchainService.getDatabase().getModel<SyncStateDoc>(BlockchainService.SYNC_STATE_COLLECTION);
        return syncModel.findOne({ key: 'blockchain:last-block' }).lean() as Promise<SyncStateFields | null>;
    }

    /**
     * Acquire a distributed lock to ensure only one scheduler instance runs at a time.
     *
     * Uses Redis SET NX with TTL to claim the lock atomically. This prevents multiple backend instances from scheduling
     * duplicate block jobs, which would waste API quota and cause race conditions during database writes.
     */
    private async acquireLock(): Promise<boolean> {
        const result = await this.redis.set(
            blockchainConfig.lock.key,
            this.lockToken,
            'EX',
            blockchainConfig.lock.ttlSeconds,
            'NX'
        );
        return result === 'OK';
    }

    /**
     * Release the distributed scheduler lock using Lua script for atomic check-and-delete.
     * Only releases the lock if this instance still owns it, preventing accidental deletion of another instance's lock after TTL expiry.
     */
    private async releaseLock() {
        try {
            await this.redis.eval(
                "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
                1,
                blockchainConfig.lock.key,
                this.lockToken
            );
        } catch (error) {
            logger.warn({ error }, 'Failed to release block sync lock');
        }
    }

    /**
     * Decide whether sync should treat itself as caught up to the chain head.
     *
     * The answer drives the per-block adaptive throttle: caught up paces blocks
     * to TRON's ~3s cadence so the live feed reads smoothly, behind runs flat
     * out to close the gap. The decision itself is a pure function in
     * `sync-mode.ts` — this method only supplies the configured thresholds and
     * the mode remembered from the previous tick.
     *
     * @param blocksBehind - How far the local cursor trails the network head.
     * @returns True to throttle to live cadence, false to run flat out.
     */
    private resolveCaughtUp(blocksBehind: number): boolean {
        return resolveCaughtUpMode(blocksBehind, this.wasCaughtUp, {
            resumeBlocks: blockchainConfig.network.liveChainThrottleBlocks,
            entryBlocks: blockchainConfig.network.backfillEntryBlocks
        });
    }

    /**
     * Record the height that has been fetched into the buffer.
     *
     * This exists because the buffer sits between fetching and writing, so the
     * two heights genuinely differ. The persisted cursor says what has been
     * written; this says what has been fetched. The scheduler's forward walk and
     * its caught-up decision both have to use this one, because a walk driven by
     * the written cursor would re-enqueue every block still sitting in the
     * buffer, and lag measured from the written cursor would report the buffer's
     * own depth as if the syncer were falling behind.
     *
     * Stored rather than kept in memory because the Redis sync lock can move to
     * another instance between ticks, and an instance that read a stale height
     * would refetch work already in flight.
     *
     * Advanced with `$max` so a backfill block, which is below the live cursor,
     * cannot drag the height backwards.
     *
     * @param blockNumber - Height that has now been fetched and buffered.
     */
    private async recordFetchedBlock(blockNumber: number): Promise<void> {
        const syncModel = BlockchainService.getDatabase().getModel<SyncStateDoc>(BlockchainService.SYNC_STATE_COLLECTION);

        await syncModel.updateOne(
            { key: 'blockchain:last-block' },
            { $max: { 'meta.lastFetchedBlock': blockNumber } },
            { upsert: true }
        );
    }

    /**
     * Write a released block and advance the sync cursor.
     *
     * This is the commit half of the pipeline, called by `BlockCommitter` when a
     * block's slot arrives. It is the moment the block becomes visible to
     * everything that reads the database, which is why the observers, the alert
     * rules, and the `block:new` broadcast all run immediately after it rather
     * than anywhere earlier.
     *
     * The writes are ordered transactions, then the block document, then the
     * cursor. The cursor goes last on purpose: it is the marker that says
     * everything below it is complete, so advancing it before the other two
     * would let a crash leave a gap that nothing looks for again.
     *
     * @param prepared - The block to write, carrying its parsed transactions,
     *                   aggregates, and the timings accumulated while preparing.
     */
    private async persistPreparedBlock(prepared: IPreparedBlock): Promise<void> {
        const { blockNumber, blockData, stats, rawTransactionCount, timings } = prepared;
        const commitStart = Date.now();
        const txModel = BlockchainService.getDatabase().getModel<TransactionDoc>(BlockchainService.TRANSACTIONS_COLLECTION);
        const blockModel = BlockchainService.getDatabase().getModel<BlockDoc>(BlockchainService.BLOCKS_COLLECTION);
        const syncModel = BlockchainService.getDatabase().getModel<SyncStateDoc>(BlockchainService.SYNC_STATE_COLLECTION);

        // Built here rather than carried through the buffer because each entry
        // spreads a copy of its transaction's payload, so holding them would
        // roughly double what a buffered block costs in memory for no gain.
        let stageStart = Date.now();
        const operations: AnyBulkWriteOperation<TransactionDoc>[] = blockData.transactions.map(transaction => ({
            updateOne: {
                filter: { txId: transaction.payload.txId },
                // ITransactionPersistencePayload deliberately widens `type` to string;
                // the driver's $set typing requires TransactionDoc's TronTransactionType
                // union, so narrow only that field and keep the rest compiler-checked.
                update: {
                    $set: {
                        ...transaction.payload,
                        type: transaction.payload.type as TransactionDoc['type']
                    }
                },
                upsert: true
            }
        }));

        if (operations.length) {
            await txModel.bulkWrite(operations, { ordered: false });
        }
        timings.bulkWriteTransactions = Date.now() - stageStart;

        stageStart = Date.now();
        await blockModel.updateOne(
            { blockNumber },
            {
                $set: {
                    blockId: blockData.blockId,
                    parentHash: blockData.parentHash,
                    witnessAddress: blockData.witnessAddress,
                    timestamp: blockData.timestamp,
                    transactionCount: rawTransactionCount,
                    size: blockData.size,
                    stats,
                    receiptsFetched: blockData.receiptsFetched,
                    processedAt: new Date()
                }
            },
            { upsert: true }
        );
        timings.updateBlockModel = Date.now() - stageStart;

        stageStart = Date.now();
        await syncModel.updateOne(
            { key: 'blockchain:last-block' },
            { $setOnInsert: { cursor: { blockNumber } } },
            { upsert: true }
        );

        await syncModel.updateOne(
            { key: 'blockchain:last-block' },
            {
                $max: { 'cursor.blockNumber': blockNumber },
                $pull: { 'meta.backfillQueue': blockNumber }
            }
        );
        timings.updateSyncState = Date.now() - stageStart;

        // Work time, not wall-clock time. The gap between preparing a block and
        // committing it is the buffer's lead, which is a deliberate wait rather
        // than effort spent, and including it would make every healthy block
        // read as roughly one block period — the exact confusion this figure was
        // changed to remove.
        timings.commit = Date.now() - commitStart;
        timings.total = (timings.prepare ?? 0) + timings.commit;

        await syncModel.updateOne(
            { key: 'blockchain:last-block' },
            {
                $set: {
                    'meta.lastProcessedAt': new Date(),
                    'meta.lastProcessedBlockId': blockData.blockId,
                    'meta.lastProcessedBlockNumber': blockNumber,
                    'meta.lastTimings': timings,
                    'meta.lastTransactionCount': rawTransactionCount
                }
            }
        );
    }

    /**
     * Drop the fetch height back to what was actually written.
     *
     * The buffer holds blocks that have been fetched and parsed but not yet
     * committed, and it lives only in memory. A process that stops for any
     * reason — a deploy, a crash, a container restart — loses them. Because the
     * fetch height was advanced when each was buffered, a new process would
     * otherwise start its forward walk above blocks that never reached MongoDB
     * and leave a permanent hole in the history.
     *
     * Resetting it to the persisted cursor makes the next tick's forward walk
     * fetch exactly those blocks again. Nothing else is needed, and that is the
     * main practical benefit of buffering ahead of the write rather than behind
     * it: a lost buffer is lost work rather than lost data, so recovery is one
     * assignment instead of a repair queue.
     *
     * Call this once at startup, before the scheduler ticks.
     *
     * @returns How many blocks the height was rewound by, so a caller or a test
     *          can tell a real recovery from a clean boot without reading the
     *          log.
     */
    public async resetFetchHeightToCursor(): Promise<number> {
        const state = await this.getSyncState();
        const cursor = resolveCursorBlock(state?.cursor);
        const fetched = this.resolveFetchedBlock(state);

        // A fresh install has neither, and there is nothing to rewind to.
        if (cursor === null || fetched === null || fetched <= cursor) {
            return 0;
        }

        const syncModel = BlockchainService.getDatabase().getModel<SyncStateDoc>(BlockchainService.SYNC_STATE_COLLECTION);
        await syncModel.updateOne(
            { key: 'blockchain:last-block' },
            { $set: { 'meta.lastFetchedBlock': cursor } }
        );

        return fetched - cursor;
    }

    /**
     * Read the fetch height from the stored sync state, falling back to the
     * written cursor.
     *
     * The fallback is what makes the first boot after this change behave
     * correctly: a deployment that has never recorded a fetch height has, by
     * definition, written everything it fetched, so the cursor is the honest
     * answer. Reading a missing value as zero would restart the forward walk
     * from the beginning of the chain.
     *
     * @param state - The sync state document, or undefined when none is stored.
     * @returns The height fetched into the buffer, or null when the deployment
     *          has no cursor either and there is nothing to resume from.
     */
    private resolveFetchedBlock(state: SyncStateFields | null | undefined): number | null {
        const raw = (state?.meta as Record<string, unknown> | undefined)?.lastFetchedBlock;
        const parsed = typeof raw === 'number' ? raw : Number(raw);

        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed;
        }

        return resolveCursorBlock(state?.cursor);
    }

    /**
     * Decide whether the block currently being processed counts as live work,
     * judging from the block itself rather than from the flag the scheduler
     * stamped on the job.
     *
     * Live work goes into the emitter's buffer and is released on the feed's
     * cadence. Anything else is broadcast immediately, because holding a block
     * from hours ago for a live slot spends that slot on data nobody is waiting
     * for and puts the syncer further behind.
     *
     * The scheduler decides once per tick and that answer then rides along on
     * every job in the batch. A batch queued while the syncer was behind
     * therefore stayed classified as behind long after it had caught up, and a
     * batch queued while caught up kept the live classification even as the
     * chain ran away from it. Re-deciding here, from the block's own header
     * timestamp, costs nothing and cannot go stale.
     *
     * The same dead band the scheduler uses applies, so a lag hovering on a
     * threshold does not flip the classification block by block.
     *
     * @param blockTime - The block header timestamp, already normalized.
     * @param schedulerCaughtUp - The scheduler's answer from enqueue time. Used
     *                            only to seed the very first block after a
     *                            restart, when there is no previous block's
     *                            classification to fall back on inside the dead
     *                            band.
     * @returns True to buffer this block for the feed's cadence, false to
     *          broadcast it as soon as it is ready.
     */
    private resolveBlockPacing(blockTime: Date, schedulerCaughtUp: boolean): boolean {
        const intervalMs = blockchainConfig.network.blockIntervalSeconds * 1000;
        const blocksBehind = resolveBlockAgeInBlocks(blockTime, Date.now(), intervalMs);

        const caughtUp = resolveCaughtUpMode(
            blocksBehind,
            this.blockPacingCaughtUp ?? schedulerCaughtUp,
            {
                resumeBlocks: blockchainConfig.network.liveChainThrottleBlocks,
                entryBlocks: blockchainConfig.network.backfillEntryBlocks
            }
        );

        this.blockPacingCaughtUp = caughtUp;

        return caughtUp;
    }

    /**
     * Report how the commit buffer is doing, for the `/system` console.
     *
     * Exposed on the service because the buffer is the half of the pipeline an
     * operator cannot infer from the sync cursor. The cursor tracks what has
     * been written, which is deliberately a buffer's depth behind the chain, so
     * on its own it cannot distinguish a healthy lead from a syncer falling
     * behind. The buffer's depth and underrun count are what do.
     *
     * @returns The emitter's current depth, target, and counters.
     */
    public getEmitBufferMetrics() {
        return this.emitter.getMetrics();
    }

    /**
     * Report the commit backlog for the `/system` console.
     *
     * Separate from the emit-buffer metrics because the two answer different
     * questions. The emitter reports blocks waiting for a slot; this reports
     * blocks that were given one and have not been written yet. A backlog here
     * is the only symptom of writing having fallen behind the release clock, and
     * nothing else on the console would show it.
     *
     * @returns The committer's queue depth, last committed height, and failures.
     */
    public getCommitMetrics(): IBlockCommitMetrics {
        return this.committer.getMetrics();
    }

    /**
     * Schedule new blocks for processing by comparing local state against the latest network height.
     *
     * This method runs periodically (via scheduler) to queue blocks that need ingestion. It prioritizes missing blocks from
     * the backfill queue before advancing the main cursor, ensuring gap-free historical data. The scheduler acquires a distributed
     * lock to prevent concurrent runs across multiple backend instances, then enqueues block jobs for the worker to process serially
     * with rate limiting. On fresh installs it starts from the current network height instead of block 0 to avoid months of backfill.
     */
    async syncLatestBlocks() {
        if (!(await this.acquireLock())) {
            logger.debug('Skipping block sync; lock already held');
            return;
        }

        try {
            const state = await this.getSyncState();
            const chainHead = await this.resolveChainHead(state);
            const latestNetworkBlock = chainHead.blockNumber;
            const lastProcessed = this.getLastProcessedBlock(state, latestNetworkBlock);
            const parityTarget = this.getParityTarget(state);
            const existingBackfill = this.getBackfillQueue(state);

            // The forward walk resumes from what has been *fetched*, not from
            // what has been written. Those two now differ by whatever the buffer
            // holds, and walking forward from the written cursor would re-enqueue
            // every block still waiting for its commit slot on every tick.
            //
            // Backfill and gap detection still use the written cursor, because
            // what they are looking for is a hole in stored history, and a block
            // sitting in the buffer is not a hole — it is work in flight.
            const lastFetched = Math.max(lastProcessed, this.resolveFetchedBlock(state) ?? lastProcessed);

            // How far forward the cursor may advance this tick. The reserve is
            // zero by default, which makes this the chain head. It does not
            // buffer work: this tick enqueues everything from the cursor up to
            // the target, so a nonzero reserve only settles the cursor that many
            // blocks lower while the batch stays exactly one tick's production.
            // The knob is kept for a deployment that wants deliberate distance
            // from a tip its provider serves inconsistently. Uneven arrival is
            // smoothed on the client, by the playout buffer in `SocketBridge`.
            const liveTip = latestNetworkBlock - Math.max(0, blockchainConfig.network.liveTipReserveBlocks);

            const { targets, remainingBackfill } = await this.computeBlockTargets({
                lastProcessed,
                lastFetched,
                latestNetworkBlock,
                liveTip,
                parityTarget,
                existingBackfill
            });

            const syncModel = BlockchainService.getDatabase().getModel<SyncStateDoc>(BlockchainService.SYNC_STATE_COLLECTION);

            if (!targets.length) {
                logger.debug({ lastProcessed, latestNetworkBlock }, 'No new blocks to schedule');

                // An unreachable head reaches this branch routinely: with the
                // ceiling frozen, the forward walk runs out of blocks as soon as
                // the cursor catches up to it. Recording the failure here too is
                // what stops that from reading as an idle, healthy sync.
                const idleUpdate: Record<string, unknown> = {
                    'meta.lastNetworkHeight': latestNetworkBlock,
                    'meta.lastScheduledAt': new Date(),
                    'meta.backfillQueue': remainingBackfill
                };

                if (chainHead.fromCache) {
                    idleUpdate['meta.lastError'] = `Chain head unreachable; nothing to schedule below the last known height (${latestNetworkBlock}).`;
                    idleUpdate['meta.lastErrorAt'] = new Date();
                }

                await syncModel.updateOne(
                    { key: 'blockchain:last-block' },
                    { $set: idleUpdate },
                    { upsert: true }
                );
                return;
            }

            // Filter out blocks in cooldown period (failed within last 5 minutes)
            const eligibleTargets: number[] = [];
            for (const blockNumber of targets) {
                const inCooldown = await this.isBlockInCooldown(blockNumber);
                if (inCooldown) {
                    logger.debug({ blockNumber }, 'Skipping block in cooldown period');
                    continue;
                }
                eligibleTargets.push(blockNumber);
            }

            // Measured from the fetch height, not the written cursor. The
            // question this answers is whether *ingestion* is keeping up, and
            // ingestion is fetching — the written cursor deliberately trails by
            // the buffer's depth, so measuring from it would report a healthy
            // syncer as permanently that many blocks behind and eat most of the
            // headroom below the dead band that decides when to stop buffering.
            //
            // Measured against the live tip rather than the raw chain head, so a
            // syncer sitting exactly where the reserve intends reads as zero
            // blocks behind. Measuring against the head would charge the
            // deliberate reserve against the mode thresholds as well.
            const blocksBehind = Math.max(0, liveTip - lastFetched);
            const isCaughtUp = this.resolveCaughtUp(blocksBehind);

            // Log transitions between caught-up and backfill modes
            if (this.wasCaughtUp !== null && isCaughtUp !== this.wasCaughtUp) {
                if (isCaughtUp) {
                    logger.info({ blocksBehind, lastProcessed, latestNetworkBlock }, 'Blockchain sync caught up to chain head');
                } else {
                    logger.info({ blocksBehind, lastProcessed, latestNetworkBlock }, 'Blockchain sync entering backfill mode');
                }
            }
            this.wasCaughtUp = isCaughtUp;

            for (const blockNumber of eligibleTargets) {
                await this.queue.enqueue(
                    'sync-block',
                    { blockNumber, isCaughtUp },
                    {
                        jobId: `block-${blockNumber}`
                        // No attempts/backoff config - use queue defaults (single attempt, TronGrid handles retries)
                    }
                );
            }

            // A tick that ran on a cached height did schedule work, but it did
            // not prove the head is reachable. Clearing the error here would
            // report a healthy sync to `/system` for as long as the fallback
            // keeps succeeding, which is the whole window an operator needs to
            // see. So the error is recorded rather than cleared, and only a
            // tick that actually read the head clears it.
            const scheduleUpdate: Record<string, unknown> = {
                $setOnInsert: { cursor: { blockNumber: lastProcessed } },
                $set: {
                    'meta.backfillQueue': remainingBackfill,
                    'meta.lastNetworkHeight': latestNetworkBlock,
                    'meta.lastScheduledAt': new Date(),
                    'meta.lastBatchSize': targets.length
                }
            };

            if (chainHead.fromCache) {
                Object.assign(scheduleUpdate.$set as Record<string, unknown>, {
                    'meta.lastError': `Chain head unreachable; scheduled against the last known height (${latestNetworkBlock}). `
                        + 'Backfill is still running, and blocks above that height wait for the head to answer.',
                    'meta.lastErrorAt': new Date()
                });
            } else {
                scheduleUpdate.$unset = {
                    'meta.lastError': '',
                    'meta.lastErrorAt': ''
                };
            }

            await syncModel.updateOne({ key: 'blockchain:last-block' }, scheduleUpdate, { upsert: true });

            // Skipped on a cached height, because the figure would be measured
            // against a ceiling that stopped moving. Lag looks better the longer
            // the head stays unreachable, which is the opposite of the truth and
            // exactly the wrong thing to put in the log.
            const lag = latestNetworkBlock - lastProcessed;
            if (!chainHead.fromCache && lag > blockchainConfig.maxNetworkLagBeforeBackoff) {
                logger.warn({ lag, lastProcessed, latestNetworkBlock }, 'Blockchain sync is behind latest network block');
            }
        } catch (error) {
            logger.error({ error }, 'Failed to schedule blockchain sync');

            if (error instanceof Error && error.message) {
                const errorMessage = error.message;
                let userFriendlyMessage = errorMessage;

                // Generate user-friendly error messages
                if (errorMessage.includes('429') || errorMessage.includes('Too Many Requests')) {
                    userFriendlyMessage = 'TronGrid API rate limit exceeded (HTTP 429). Consider adding more API keys or reducing request frequency.';
                } else if (errorMessage.includes('API key')) {
                    if (!env.TRONGRID_API_KEY) {
                        userFriendlyMessage = 'TronGrid API key not configured. Set TRONGRID_API_KEY in your environment to enable blockchain sync. Get your free API key at https://www.trongrid.io/';
                    } else {
                        userFriendlyMessage = `TronGrid API error: ${errorMessage}. Please check your API key configuration.`;
                    }
                } else if (errorMessage.includes('SSL') || errorMessage.includes('TLS') || errorMessage.includes('cipher')) {
                    userFriendlyMessage = 'TLS/SSL cipher compatibility issue detected. This is a known issue in some development environments (WSL/OpenSSL 3.x) and does not affect production. The sync will retry automatically.';
                } else if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ETIMEDOUT')) {
                    userFriendlyMessage = `Network connection failed. ${errorMessage}`;
                }

                // Store error state for monitoring (store as string for simplicity in sync errors)
                const errorSyncModel = BlockchainService.getDatabase().getModel<SyncStateDoc>(BlockchainService.SYNC_STATE_COLLECTION);
                await errorSyncModel.updateOne(
                    { key: 'blockchain:last-block' },
                    {
                        $set: {
                            'meta.lastError': userFriendlyMessage,
                            'meta.lastErrorAt': new Date()
                        }
                    },
                    { upsert: true }
                );
            }
        } finally {
            await this.releaseLock();
        }
    }

    /**
     * Extract the parity target block height from sync state metadata.
     *
     * The parity target represents a desired historical sync point, allowing the scheduler to backfill towards a specific block height
     * when catching up with external systems or recovering from data gaps. Returns null if no parity target is configured.
     */
    private getParityTarget(state: SyncStateFields | null): number | null {
        if (!state?.meta) {
            return null;
        }
        const value = (state.meta as Record<string, unknown>)[blockchainConfig.parity.durableObjectHeightMetaKey];
        if (typeof value === 'number' && value > 0) {
            return value;
        }
        return null;
    }

    /**
     * Load the list of missing block numbers that need backfill processing.
     *
     * The backfill queue accumulates blocks that failed during initial sync or were skipped due to gaps, ensuring eventual complete
     * historical coverage. The scheduler prioritizes these blocks before advancing the main cursor to maintain data continuity.
     */
    private getBackfillQueue(state: SyncStateFields | null): number[] {
        if (!state?.meta) {
            return [];
        }
        const { backfillQueue } = state.meta as Record<string, unknown>;
        if (!Array.isArray(backfillQueue)) {
            return [];
        }
        return backfillQueue
            .map(value => Number(value))
            .filter(value => Number.isFinite(value) && value > 0)
            .sort((a, b) => a - b);
    }

    /**
     * Determine the last successfully processed block number from sync state.
     *
     * On fresh installs with no sync state, this returns the current network height instead of block 0 to avoid months of unnecessary
     * historical backfill. For existing installations it reads the cursor from MongoDB, handling both numeric and string-encoded values
     * for database compatibility across different MongoDB driver versions.
     */
    private getLastProcessedBlock(state: SyncStateFields | null, latestNetworkBlock: number): number {
        const cursor = resolveCursorBlock(this.readCursorField(state));

        if (cursor === null) {
            logger.info({ latestNetworkBlock }, 'No usable sync cursor; starting sync from the current block');
        }

        return cursor ?? latestNetworkBlock;
    }

    /**
     * Pull the raw cursor field out of a sync state document.
     *
     * The reading rules for that field live in `chain-head.ts` so its two
     * consumers cannot disagree about what counts as a usable cursor. This
     * method only knows where the field sits, which is the part specific to
     * this document's shape.
     *
     * @param state - Sync state as loaded from MongoDB, or null before the
     *                document exists.
     * @returns The `cursor.blockNumber` value untouched, for the pure reader to
     *          interpret.
     */
    private readCursorField(state: SyncStateFields | null): unknown {
        return state?.cursor ? (state.cursor as Record<string, unknown>).blockNumber : undefined;
    }

    /**
     * Work out which chain height this tick should schedule against.
     *
     * A single failed call to `getnowblock` used to abort the whole tick. That
     * cost far more than the one lookup: the tick also schedules the backfill
     * queue, and backfill blocks are old work that never needed the head at
     * all, so one flaky request stopped repair work that would have succeeded.
     * Falling back to the height recorded by the previous tick keeps that work
     * moving while the head is unreachable.
     *
     * The fallback cannot cause a block to be processed twice. The height is
     * only ever the *ceiling* of the forward walk in `computeBlockTargets`,
     * which starts at the stored cursor, so a stale height can only make the
     * batch smaller. It can never walk back over ground the cursor has covered.
     *
     * Two rules keep it that way, and both matter:
     *
     * The height is used exactly as it was recorded, never extrapolated from
     * elapsed time. A height above the real chain head would schedule blocks
     * TRON has not produced, and each one costs six retries in the TronGrid
     * client before landing in cooldown and the backfill queue as a phantom
     * entry.
     *
     * The fallback is refused when there is no usable cursor. In that case
     * `getLastProcessedBlock` seeds the cursor *from* the height rather than
     * bounding a walk with it, so a stale value would permanently start the
     * deployment at the wrong place. A cold start genuinely needs a live head,
     * and waiting for the next tick costs nothing.
     *
     * @param state - Sync state for this tick, supplying both the cursor that
     *                decides whether the fallback is allowed and the height it
     *                would use.
     * @returns The height to schedule against, flagged when it came from cache.
     * @throws The original lookup error when there is no usable cached height,
     *         leaving the caller's existing error handling to record it.
     */
    private async resolveChainHead(state: SyncStateFields | null): Promise<IChainHead> {
        let head: IChainHead;

        try {
            const latestBlock = await this.tronClient.getNowBlock();

            head = { blockNumber: latestBlock.block_header.raw_data.number, fromCache: false };
        } catch (error) {
            const cached = resolveCachedHead(
                this.readCursorField(state),
                (state?.meta as Record<string, unknown> | undefined)?.lastNetworkHeight
            );

            if (cached === null) {
                throw error;
            }

            logger.warn(
                { error, cachedNetworkHeight: cached },
                'Chain head lookup failed; scheduling against the height recorded by the previous tick'
            );

            head = { blockNumber: cached, fromCache: true };
        }

        return head;
    }

    /**
     * Calculate which blocks to schedule for processing in this scheduler run.
     *
     * Prioritizes backfill queue entries (missed/failed blocks) before advancing the main cursor to ensure gap-free historical data.
     * Respects the configured batch size limit to prevent queue flooding, and includes parity target blocks when configured to align
     * with external system requirements. Returns both the blocks to process immediately and the remaining backfill queue for future runs.
     *
     * @param params.lastProcessed - The written cursor, used for gap detection, because a hole in stored history is what backfill looks for.
     * @param params.lastFetched - How far fetching has got, which is where the forward walk resumes. Higher than the written cursor by
     *                             whatever the commit buffer holds, and walking from the written cursor instead would re-enqueue every
     *                             block still waiting for its slot.
     * @param params.latestNetworkBlock - The raw chain head, used to discard backfill and parity entries that do not exist yet.
     * @param params.liveTip - How far forward the cursor may advance this run, which is the head minus the deliberate reserve. Passed in
     *                         rather than recomputed here so the caller's mode decision and this selection cannot disagree about where
     *                         the tip is.
     * @param params.parityTarget - An operator-set height to align with an external system, or null when none is configured.
     * @param params.existingBackfill - Block numbers already queued for backfill from previous runs.
     * @returns The blocks to enqueue now, and the backfill entries left over for the next run so none are silently dropped.
     */
    private async computeBlockTargets(params: {
        lastProcessed: number;
        lastFetched: number;
        latestNetworkBlock: number;
        liveTip: number;
        parityTarget: number | null;
        existingBackfill: number[];
    }): Promise<{ targets: number[]; remainingBackfill: number[] }> {
        const { lastProcessed, lastFetched, latestNetworkBlock, liveTip, parityTarget, existingBackfill } = params;
        const backfillSet = new Set<number>(existingBackfill);

        const newlyMissing = await this.identifyMissingBlocks(lastProcessed);
        newlyMissing.forEach(num => backfillSet.add(num));

        const sortedBackfill = Array.from(backfillSet)
            .filter(num => num > 0 && num <= latestNetworkBlock)
            .sort((a, b) => a - b);

        const targets: number[] = [];
        const selected = new Set<number>();
        const maxBatch = blockchainConfig.batchSize;

        for (const blockNumber of sortedBackfill) {
            if (selected.size >= maxBatch) {
                break;
            }
            if (!selected.has(blockNumber)) {
                selected.add(blockNumber);
                targets.push(blockNumber);
                backfillSet.delete(blockNumber);
            }
        }

        // The forward walk stops at the live tip, which equals the chain head
        // unless a deployment configured distance from it. Backfill and parity
        // above always use the raw head, because a block already known to be
        // missing is old work and holding it back would serve no purpose.
        let nextBlock = lastFetched + 1;
        while (selected.size < maxBatch && nextBlock <= liveTip) {
            if (!selected.has(nextBlock)) {
                selected.add(nextBlock);
                targets.push(nextBlock);
            }
            nextBlock += 1;
        }

        if (parityTarget && parityTarget > lastFetched) {
            let parityBlock = lastFetched + 1;
            while (parityBlock <= parityTarget) {
                if (!selected.has(parityBlock) && parityBlock <= latestNetworkBlock) {
                    if (selected.size < maxBatch) {
                        selected.add(parityBlock);
                        targets.push(parityBlock);
                    } else {
                        backfillSet.add(parityBlock);
                    }
                }
                parityBlock += 1;
            }
        }

        targets.sort((a, b) => a - b);
        const remainingBackfill = Array.from(backfillSet)
            .filter(num => num > 0 && num <= latestNetworkBlock && !selected.has(num))
            .sort((a, b) => a - b);

        return { targets, remainingBackfill };
    }

    /**
     * Scan the database for gaps in processed block history and return missing block numbers.
     *
     * Queries MongoDB to find which blocks between the configured backfill window and the last processed block are absent from the database,
     * indicating sync failures or skipped blocks that need reprocessing. Limits results to the maximum backfill per run to prevent excessive
     * memory usage and ensure the scheduler remains responsive even when large gaps exist.
     */
    private async identifyMissingBlocks(lastProcessed: number): Promise<number[]> {
        if (lastProcessed <= 1) {
            return [];
        }

        const lowerBound = Math.max(lastProcessed - blockchainConfig.maxBackfillPerRun, 1);
        const blockModel = BlockchainService.getDatabase().getModel<BlockDoc>(BlockchainService.BLOCKS_COLLECTION);
        const existing = await blockModel.find({
            blockNumber: { $gte: lowerBound, $lt: lastProcessed }
        })
            .select('blockNumber')
            .lean() as BlockFields[];

        const existingSet = new Set<number>(existing.map(block => block.blockNumber));
        const missing: number[] = [];

        for (let block = lowerBound; block < lastProcessed; block += 1) {
            if (!existingSet.has(block)) {
                missing.push(block);
            }
            if (missing.length >= blockchainConfig.maxBackfillPerRun) {
                break;
            }
        }

        return missing;
    }

    /**
     * Fetch, parse, enrich, and persist a single blockchain block with all its transactions.
     *
     * This is the core ingestion workflow executed by the BullMQ worker. It fetches raw block data from TronGrid, normalizes timestamps,
     * enriches each transaction with USD pricing and address insights, notifies observers for plugin reactions, writes everything to MongoDB,
     * calculates block-level statistics, and broadcasts socket events for real-time UI updates. Transaction failures are isolated so one
     * corrupt record doesn't block the entire block, and blocks that fail completely enter cooldown before retry to avoid API waste.
     *
     * Nothing in this method waits on a clock. When the block is live work rather than backfill, its finished event goes to `BlockEmitter`,
     * which holds a lead of already-fetched blocks and releases them at TRON's own three-second cadence. The wait used to sit here, right
     * before the broadcast, but this runs inside a worker that processes one job at a time: waiting here blocked the next fetch, so the
     * pipeline never accumulated a reserve and any upstream hiccup showed as a gap in the feed. Whether a block is live work at all is decided
     * here from the block's own timestamp, not from the scheduler's flag, because that flag is stamped once per batch and goes stale within it.
     *
     * @param blockNumber - The block number to process
     * @param isCaughtUp - The scheduler's answer from enqueue time. Only seeds the decision for the first block after a restart; every
     *                     block after that is judged on its own age, since a batch can span several ticks of work.
     */
    private async processBlock(blockNumber: number, isCaughtUp: boolean) {
        const timings: Record<string, number> = {};
        const startTotal = Date.now();

        logger.debug({ blockNumber }, `Processing block ${blockNumber}`);

        try {
            // Stage 1: Fetch block from TronGrid first to get its timestamp for calculations
            let stageStart = Date.now();
            const block = await this.tronClient.getBlockByNumber(blockNumber);
            timings.fetchBlock = Date.now() - stageStart;

            // Validate block structure before proceeding
            if (!block?.block_header?.raw_data?.timestamp) {
                logger.error({ blockNumber, block }, 'Invalid block structure - missing timestamp');
                throw new Error(`Invalid block structure returned from TronGrid API for block ${blockNumber} - missing timestamp`);
            }

            // Parse and normalize block timestamp
            const transactions = block.transactions ?? [];
            let blockTime: Date;
            try {
                const rawTimestamp = block.block_header.raw_data.timestamp;
                let normalizedTimestamp = rawTimestamp;

                if (typeof rawTimestamp === 'number') {
                    if (rawTimestamp > 9_999_999_999_999) {
                        normalizedTimestamp = Math.floor(rawTimestamp / 1_000);
                    }

                    if (normalizedTimestamp > 9_999_999_999_999) {
                        normalizedTimestamp = Math.floor(normalizedTimestamp / 1_000);
                    }
                }

                blockTime = new Date(normalizedTimestamp);

                if (isNaN(blockTime.getTime())) {
                    throw new Error('Invalid normalized block timestamp');
                }
            } catch (dateError) {
                logger.error({ blockNumber, timestamp: block.block_header.raw_data.timestamp, dateError }, 'Invalid block timestamp');
                throw new Error(`Invalid timestamp in block ${blockNumber}: ${block.block_header.raw_data.timestamp} (${dateError instanceof Error ? dateError.message : String(dateError)})`);
            }

            // Stage 2: Get TRX price
            stageStart = Date.now();
            const priceUSD = await this.priceService.getTrxPriceUsd();
            timings.getTrxPrice = Date.now() - stageStart;

            const buildContext: TransactionBuildContext = {
                priceUSD,
                blockTime
            };

            // Stage 3: Transaction receipts, only when an operator has switched
            // them on at /system/system?tab=config.
            //
            // The block response already carries everything sync needs to index a
            // transaction — amounts, addresses, types, memos — so receipts are
            // pure enrichment: energy, bandwidth, and internal transactions, and
            // the block-level totals that sum them. They cost one extra TronGrid
            // call for the whole block, not one per transaction, but that is still
            // a real change to a live deployment's upstream traffic and to the
            // shape of the documents it writes. Off by default, so a deployment
            // that never touches the switch behaves exactly as it always has.
            stageStart = Date.now();
            const receiptsEnabled = await this.shouldFetchBlockReceipts();
            const receipts = receiptsEnabled
                ? await this.fetchBlockReceipts(blockNumber, transactions.length)
                : new Map<string, TronGridTransactionInfo>();
            timings.fetchReceipts = Date.now() - stageStart;

            // Recorded on the block so a consumer can tell a measured zero from
            // an unmeasured one. A block holding no transactions is complete
            // however the switch is set: there was nothing to retrieve, and every
            // receipt-derived total is zero because the block is empty rather
            // than because nobody looked. Any other block needs the switch on and
            // a receipt for every transaction, because a fetch that failed or came
            // back short leaves totals that undercount, and an undercount is not a
            // measurement.
            const receiptsFetched = transactions.length === 0 || (receiptsEnabled && receipts.size === transactions.length);

            // Stage 4: Process transactions loop.
            //
            // Observers are no longer notified here. They are notified when the
            // block is announced, on the emitter's clock, because notifying them
            // at ingestion speed pushed a whole tick's worth of blocks through
            // them in a burst and put any plugin broadcasting from inside an
            // observer ahead of the block feed by the buffer's lead. Parsing and
            // persistence stay here at full speed, so the sync cursor and every
            // lag figure derived from it keep their current meaning.
            stageStart = Date.now();
            const processed: ProcessedTransaction[] = [];
            const operations: AnyBulkWriteOperation<TransactionDoc>[] = [];

            for (const transaction of transactions) {
                try {
                    // Null when receipts are switched off, or when this particular
                    // transaction had none in the batch response. Either way the
                    // record still builds; only the energy, bandwidth, and
                    // internal-transaction fields go unpopulated, which is what
                    // every deployment has had until the switch existed.
                    const info = receipts.get(transaction.txID) ?? null;
                    const result = this.buildTransactionRecord(block, transaction, info, buildContext);
                    if (!result) {
                        continue;
                    }

                    processed.push(result);
                    operations.push({
                        updateOne: {
                            filter: { txId: result.payload.txId },
                            // ITransactionPersistencePayload deliberately widens `type` to string;
                            // the driver's $set typing requires TransactionDoc's TronTransactionType
                            // union, so narrow only that field and keep the rest compiler-checked.
                            update: {
                                $set: {
                                    ...result.payload,
                                    type: result.payload.type as TransactionDoc['type']
                                }
                            },
                            upsert: true
                        }
                    });
                } catch (transactionError) {
                    logger.warn({ blockNumber, txId: transaction?.txID, transactionError }, 'Failed to process transaction - skipping');
                }
            }
            timings.processTransactions = Date.now() - stageStart;

            // Stage 4b: Assemble the block observers will receive. Building it
            // here and notifying later is the whole shape of the change — the
            // worker knows the block, the emitter knows when it is due, and
            // neither has to know the other's job.
            const blockData: IBlockData = {
                blockNumber,
                blockId: block.blockID,
                parentHash: block.block_header.raw_data.parentHash,
                witnessAddress: TronGridClient.toBase58Address(block.block_header.raw_data.witness_address) ?? 'unknown',
                timestamp: blockTime,
                transactionCount: processed.length,
                size: block.size,
                receiptsFetched,
                transactions: processed
            };

            // Stage 6: Calculate block statistics
            stageStart = Date.now();
            const stats = this.calculateBlockStats(processed);
            timings.calculateStats = Date.now() - stageStart;
            timings.prepare = Date.now() - startTotal;

            // Stage 7: Hand the prepared block to the emitter and return. Nothing
            // has been written yet, and that is the point: the emitter holds a
            // lead of *unwritten* blocks and releases one per slot, and the
            // commit happens there. Because a block does not exist at any height
            // until its slot arrives, the REST endpoints, a server-rendered
            // page, plugin-derived collections, and the live feed all report the
            // same height instead of three different ones.
            //
            // The worker does not wait here. It used to wait before the
            // broadcast, and because the worker processes one job at a time that
            // wait blocked the next fetch, so the pipeline never held a fetched
            // block in reserve and every upstream hiccup went straight to the
            // screen.
            //
            // A block too old to be live work — anything from the backfill
            // queue, or a catch-up run — is committed immediately rather than
            // buffered, since spending a live block's slot on a block from hours
            // ago is what puts the syncer further behind.
            const prepared: IPreparedBlock = {
                blockNumber,
                payload: this.buildBlockEvent(blockNumber, block, stats, processed, receiptsFetched),
                blockData,
                stats,
                rawTransactionCount: transactions.length,
                timings
            };

            if (this.resolveBlockPacing(blockTime, isCaughtUp)) {
                this.emitter.enqueue(prepared);
            } else {
                this.emitter.emitNow(prepared);
                logger.debug({ blockNumber }, 'Committing block without buffering - catching up to chain head');
            }

            // Advanced here rather than in the commit, because this is the height
            // the scheduler must walk forward from. The persisted cursor now
            // trails by whatever the buffer holds, so a forward walk driven by it
            // would re-enqueue every buffered block on the next tick.
            await this.recordFetchedBlock(blockNumber);
        } catch (error) {
            // Extract error message and details
            const errorMessage = error instanceof Error ? error.message : String(error);

            // Try to extract root cause from nested errors
            let rootCause: string | null = null;
            if (error && typeof error === 'object') {
                const err = error as { code?: string; originalError?: { code?: string; message?: string } };

                // Check for error codes in the main error or nested originalError
                if (err.code) {
                    rootCause = err.code;
                } else if (err.originalError?.code) {
                    rootCause = err.originalError.code;
                }

                // For axios errors, check response status
                const axiosErr = error as { response?: { status?: number } };
                if (axiosErr.response?.status) {
                    rootCause = `HTTP ${axiosErr.response.status}`;
                }
            }

            logger.error({ errorMessage, rootCause, blockNumber }, 'Failed to process block - exhausted all retries');

            // Generate user-friendly error message with root cause
            let userMessage: string;
            if (errorMessage.includes('429') || errorMessage.includes('Too Many Requests')) {
                userMessage = `TronGrid API rate limit exceeded while processing block ${blockNumber}`;
                if (!rootCause) rootCause = 'HTTP 429';
            } else if (errorMessage.includes('SSL') || errorMessage.includes('TLS') || errorMessage.includes('cipher')) {
                userMessage = `SSL/TLS cipher error while processing block ${blockNumber}`;
                if (!rootCause && errorMessage.includes('ERR_SSL_CIPHER_OPERATION_FAILED')) {
                    rootCause = 'ERR_SSL_CIPHER_OPERATION_FAILED';
                }
            } else if (errorMessage.includes('ECONNREFUSED')) {
                userMessage = `Network connection refused while processing block ${blockNumber}`;
                if (!rootCause) rootCause = 'ECONNREFUSED';
            } else if (errorMessage.includes('ETIMEDOUT')) {
                userMessage = `Network connection timeout while processing block ${blockNumber}`;
                if (!rootCause) rootCause = 'ETIMEDOUT';
            } else {
                userMessage = `Failed to process block ${blockNumber}: ${errorMessage}`;
            }

            // Append root cause if available
            if (rootCause) {
                userMessage += ` (${rootCause})`;
            }

            // Mark block for 5-minute cooldown before retry
            await this.markBlockFailed(blockNumber);

            // Add back to backfill queue for eventual retry (after cooldown)
            const errorDoc = {
                at: new Date().toISOString(),
                blockNumber,
                message: userMessage
            };

            logger.info({ errorDoc }, 'Storing error in database');

            const errorSyncModel = BlockchainService.getDatabase().getModel<SyncStateDoc>(BlockchainService.SYNC_STATE_COLLECTION);
            await errorSyncModel.updateOne(
                { key: 'blockchain:last-block' },
                {
                    $addToSet: { 'meta.backfillQueue': blockNumber },
                    $set: {
                        'meta.lastError': errorDoc,
                        'meta.lastErrorAt': new Date()
                    }
                },
                { upsert: true }
            );
            throw error;
        }
    }

    /**
     * Transform a raw TronGrid transaction into an enriched ProcessedTransaction model.
     *
     * This method converts hex addresses to Base58, resolves transaction amounts in both sun and TRX, applies USD pricing from the
     * block context, enriches sender and receiver addresses with exchange/wallet labels, extracts memos and contract details, and builds
     * resource consumption metrics. The resulting ProcessedTransaction provides a complete, framework-independent view of the transaction
     * that observers and the database layer can consume without touching raw TronGrid responses, making future blockchain provider swaps easier.
     */
    private buildTransactionRecord(
        block: TronGridBlock,
        transaction: TronGridTransaction,
        info: TronGridTransactionInfo | null,
        context: TransactionBuildContext
    ): ProcessedTransaction | null {
        const contract = transaction.raw_data.contract?.[0];
        if (!contract) {
            logger.warn({ txId: transaction.txID }, 'Skipping transaction without contract data');
            return null;
        }

        const contractType = normalizeContractType(contract.type);
        const value = (contract.parameter?.value ?? {}) as Record<string, unknown>;

        const timestamp = new Date(context.blockTime.getTime());
        const blockNumber = block.block_header.raw_data.number;

        const ownerAddress = resolveOwnerAddress(value);
        const recipientAddress = resolveRecipient(contractType, value, ownerAddress);

        const { rawAmountSun, amountTRX } = resolveAmounts(contractType, value);
        const amountUSD = context.priceUSD ? Number((amountTRX * context.priceUSD).toFixed(2)) : undefined;

        // Store raw hex memo data - consumers decode on frontend for display
        const memo = transaction.raw_data.data?.trim() || null;
        // Left undefined rather than defaulted to `[]`, because Mongoose strips an
        // undefined value from the cast `$set` while an empty array is a real
        // value it writes. The field is absent on the overwhelming majority of
        // transactions — 376 of 381 in a sampled mainnet block — so writing the
        // empty array cost roughly 12 KB per block, every block, to record that
        // there was nothing to record. Its one reader already counts a missing
        // value as zero.
        const internalTransactions = info?.internal_transactions?.length ? info.internal_transactions : undefined;

        const energyMetrics = this.buildEnergyMetrics(info);
        const bandwidthMetrics = this.buildBandwidthMetrics(info);

        // Native execution result rides in the block payload (ret[].contractRet),
        // so capturing it costs no extra API call. Empty string → undefined.
        const status = transaction.ret?.[0]?.contractRet || undefined;

        const fromInsight = this.addressInsights.enrich(ownerAddress);
        const toInsight = this.addressInsights.enrich(recipientAddress);

        const payload: TransactionPersistencePayload = {
            txId: transaction.txID,
            blockNumber,
            timestamp,
            type: contractType,
            // TRON protocol: resource field is "ENERGY" for energy operations, or undefined/null for BANDWIDTH
            // Observers must interpret undefined as BANDWIDTH (default resource type per TRON specification)
            subType: typeof value.resource === 'string' ? (value.resource as string) : undefined,
            status,
            from: {
                address: ownerAddress,
                type: fromInsight.type ?? 'wallet',
                name: fromInsight.name ?? undefined
            },
            to: {
                address: recipientAddress,
                type: toInsight.type ?? (recipientAddress === ownerAddress ? 'wallet' : 'wallet'),
                name: toInsight.name ?? undefined
            },
            amount: rawAmountSun,
            amountTRX,
            amountUSD,
            energy: energyMetrics,
            bandwidth: bandwidthMetrics,
            contract: describeContract(contractType, value),
            memo,
            internalTransactions,
            notifications: [],
            analysis: {
                pattern: 'unknown'
            }
        };

        const relatedAddresses = new Set<string>(
            [ownerAddress, recipientAddress].filter(address => address && address !== 'unknown')
        );

        payload.analysis = {
            ...(payload.analysis ?? {}),
            relatedAddresses: Array.from(relatedAddresses).slice(0, 50)
        };

        const snapshot = this.toSnapshot(payload);

        // Categories are now computed dynamically via ProcessedTransaction methods
        const emptyCategories: TransactionCategoryFlags = {
            isDelegation: false,
            isStake: false,
            isTokenCreation: false
        };

        // Include Permission_id in rawValue for observers that need to distinguish pool-controlled delegations
        // Permission_id >= 3 indicates the transaction was authorized by a custom permission (typically pool control)
        //
        // Also forward the wire signature(s) unconditionally: txID is
        // sha256(raw_data) — the signing digest — so an observer can
        // ecrecover the actual signing key (e.g. a rental market's
        // controller wallet signing a pool participant's delegation) with
        // no extra network calls. Permission_id alone cannot carry this:
        // the default active permission (id 2) has a mutable key set, so
        // only signer recovery distinguishes an owner signing with their
        // own active key from a granted third-party key. The strings
        // already exist on the parsed block (attaching is a reference
        // copy), and rawValue is observer-facing — core persists only
        // `payload` to the transactions collection.
        const rawValue: Record<string, unknown> = {
            ...value,
            Permission_id: contract.Permission_id,
            ...(Array.isArray(transaction.signature)
                ? { signature: transaction.signature }
                : {})
        };

        const rawTransaction: ITransaction = { payload, snapshot, categories: emptyCategories, rawValue, info };

        return new ProcessedTransaction(rawTransaction);
    }

    /**
     * Ask the providers module whether sync should fetch per-block receipts.
     *
     * The flag lives in the `provider:trongrid` config blob so an operator can
     * turn receipt enrichment on and off from `/system/system?tab=config` without
     * a redeploy. It is read here per block rather than cached because a toggle an
     * operator flips should take effect on the next block, and one key-value read
     * against Mongo is negligible beside the TronGrid HTTP call this same block
     * already makes.
     *
     * Resolution is lazy and failure-tolerant on purpose. `BlockchainService` is
     * constructed during bootstrap before `ProvidersModule.init()` has wired the
     * config singleton, so reading the flag in a field initializer would throw;
     * and a config store that is unreachable must leave sync doing exactly what it
     * does today rather than stopping it.
     *
     * @returns True only when an operator has explicitly enabled receipt
     *          fetching. Any failure to resolve the setting answers false, which
     *          is the behaviour every deployment has had until now.
     */
    private async shouldFetchBlockReceipts(): Promise<boolean> {
        let enabled = false;

        try {
            const config = await ProviderConfigService.getInstance().getTronGridConfig();
            enabled = config.fetchBlockReceipts;
        } catch (error) {
            logger.debug({ error }, 'TronGrid provider config unavailable; leaving block receipts disabled');
        }

        return enabled;
    }

    /**
     * Fetch the block's transaction receipts and index them by transaction id.
     *
     * Receipts are the only source of the energy, bandwidth, and internal
     * transaction data the block payload omits, and one call covers the whole
     * block. Indexing by `id` rather than zipping the two arrays by position is
     * what keeps the join correct: the endpoint returns a flat list, and if the
     * node ever omitted an entry a positional join would silently attach every
     * later receipt to the wrong transaction.
     *
     * @param blockNumber - The block being processed.
     * @param transactionCount - How many transactions the block holds. A block
     *                           with none is skipped entirely so an empty block
     *                           never spends a request.
     * @returns Receipts keyed by transaction id, or an empty map when the block is
     *          empty or the fetch failed.
     */
    private async fetchBlockReceipts(
        blockNumber: number,
        transactionCount: number
    ): Promise<Map<string, TronGridTransactionInfo>> {
        const receipts = new Map<string, TronGridTransactionInfo>();

        if (transactionCount === 0) {
            return receipts;
        }

        const infos = await this.tronClient.getTransactionInfoByBlockNum(blockNumber);
        for (const info of infos) {
            if (info?.id) {
                receipts.set(info.id, info);
            }
        }

        if (infos.length > 0 && receipts.size < transactionCount) {
            // Worth a line because it is the shape of a silent gap: the block is
            // still written correctly, but some transactions carry no energy or
            // bandwidth while their neighbours do, which reads as bad data rather
            // than as a partial upstream answer.
            logger.warn(
                { blockNumber, transactionCount, receiptCount: receipts.size },
                'Fewer transaction receipts than transactions in block'
            );
        }

        return receipts;
    }

    /**
     * Extract energy consumption and cost metrics from transaction receipt data.
     *
     * Energy is consumed when executing smart contracts on TRON. This method calculates the total energy used, the TRX cost paid for that energy,
     * and the effective price per unit. Returns undefined when no energy was consumed, keeping the transaction payload lean for simple transfers
     * that don't involve smart contract execution.
     */
    private buildEnergyMetrics(info: TronGridTransactionInfo | null): TransactionResource | undefined {
        const consumed = info?.receipt?.energy_usage_total ?? 0;
        const feeSun = info?.receipt?.energy_fee ?? 0;

        if (!consumed && !feeSun) {
            return undefined;
        }

        const totalCost = feeSun / 1_000_000;
        const price = consumed ? totalCost / consumed : 0;

        return {
            consumed,
            price,
            totalCost
        };
    }

    /**
     * Extract bandwidth consumption and cost metrics from transaction receipt data.
     *
     * Bandwidth is consumed for transaction data storage on TRON. This method calculates the bandwidth units used, the TRX cost for exceeding
     * free quota, and the effective price per unit. Returns undefined when no bandwidth fees were charged, which is common when accounts have
     * sufficient frozen TRX to cover transaction bandwidth costs.
     */
    private buildBandwidthMetrics(info: TronGridTransactionInfo | null): TransactionResource | undefined {
        const consumed = info?.receipt?.net_usage ?? 0;
        const feeSun = info?.receipt?.net_fee ?? 0;

        if (!consumed && !feeSun) {
            return undefined;
        }

        const totalCost = feeSun / 1_000_000;
        const price = consumed ? totalCost / consumed : 0;

        return {
            consumed,
            price,
            totalCost
        };
    }

    /**
     * Build the `block:new` event a completed block should broadcast.
     *
     * Separated from the broadcast itself because the two no longer happen at
     * the same moment: the worker builds the event as soon as the block is
     * written, and `BlockEmitter` sends it when its slot comes up, which may be
     * several seconds later. Building it here rather than storing the block and
     * its transactions for the emitter to assemble later is what keeps the
     * buffer cheap — only this small object is held per block, not the whole
     * transaction array.
     *
     * Individual transaction events are handled by plugins through the observer
     * pattern rather than centralized here.
     *
     * @param blockNumber - Height of the block being announced.
     * @param block - Raw block from TronGrid, read only for its header timestamp.
     * @param stats - Aggregates calculated for the block.
     * @param processed - Transactions that survived parsing, used for the count
     *                    the frontend displays.
     * @param receiptsFetched - Whether the receipt-derived figures in `stats`
     *                          are measurements. Carried on the event because a
     *                          live consumer reading the energy totals has no
     *                          other way to tell a real zero from an unmeasured
     *                          one.
     * @returns The payload to broadcast, ready for the wire.
     */
    private buildBlockEvent(
        blockNumber: number,
        block: TronGridBlock,
        stats: BlockStats,
        processed: ProcessedTransaction[],
        receiptsFetched: boolean
    ): IBlockNewPayload {
        const blockTimestamp = new Date(block.block_header.raw_data.timestamp);

        const payload: IBlockNewPayload = {
            blockNumber,
            timestamp: blockTimestamp.toISOString(),
            receiptsFetched,
            stats: {
                ...stats,
                transactions: processed.length
            }
        };

        return payload;
    }

    /**
     * Convert a transaction payload into a Socket.IO-ready snapshot format.
     * Transforms Date objects into ISO strings and ensures all fields are serializable for real-time transmission to WebSocket clients.
     */
    private toSnapshot(payload: TransactionPersistencePayload): TronTransactionDocument {
        return {
            txId: payload.txId,
            blockNumber: payload.blockNumber,
            timestamp: payload.timestamp.toISOString(),
            type: (payload.type as TronTransactionDocument['type']) ?? 'Unknown',
            subType: payload.subType,
            status: payload.status,
            from: payload.from,
            to: payload.to,
            amount: payload.amount ?? 0,
            amountTRX: payload.amountTRX ?? 0,
            amountUSD: payload.amountUSD,
            energy: payload.energy ?? undefined,
            bandwidth: payload.bandwidth ?? undefined,
            contract: payload.contract,
            memo: payload.memo ?? undefined,
            internalTransactions: payload.internalTransactions,
            indexed: new Date().toISOString(),
            notifications: payload.notifications,
            analysis: payload.analysis
        };
    }

    /**
     * Aggregate transaction-level data into block-level statistics.
     *
     * Counts transaction types (transfers, contract calls, delegations, stakes, token creations) and sums resource consumption metrics
     * (energy, bandwidth) across all transactions in the block. These statistics support analytics dashboards and help identify blocks
     * with unusual activity patterns, and they're computed by calling the ProcessedTransaction category methods rather than relying on
     * deprecated category flags.
     */
    private calculateBlockStats(transactions: ProcessedTransaction[]): BlockStats {
        return transactions.reduce(
            (acc, transaction) => {
                const { payload } = transaction;

                if (payload.type === 'TransferContract') {
                    acc.transfers += 1;
                }

                if (payload.type === 'TriggerSmartContract') {
                    acc.contractCalls += 1;
                }

                if (transaction.isDelegation()) {
                    acc.delegations += 1;
                }

                if (transaction.isStake()) {
                    acc.stakes += 1;
                }

                if (transaction.isTokenCreation()) {
                    acc.tokenCreations += 1;
                }

                acc.internalTransactions += payload.internalTransactions?.length ?? 0;
                acc.totalEnergyUsed += payload.energy?.consumed ?? 0;
                acc.totalEnergyCost += payload.energy?.totalCost ?? 0;
                acc.totalBandwidthUsed += payload.bandwidth?.consumed ?? 0;

                return acc;
            },
            {
                transfers: 0,
                contractCalls: 0,
                delegations: 0,
                stakes: 0,
                tokenCreations: 0,
                internalTransactions: 0,
                totalEnergyUsed: 0,
                totalEnergyCost: 0,
                totalBandwidthUsed: 0
            }
        );
    }
}
