import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import type { AnyBulkWriteOperation } from 'mongoose';
import type { Redis as RedisClient } from 'ioredis';
import type { TronTransactionDocument } from '@tronrelic/shared';
import type { ITransaction, ITransactionPersistencePayload, ITransactionCategoryFlags } from '@tronrelic/types';
import { ProcessedTransaction } from '@tronrelic/types';
import { TransactionModel, type TransactionDoc, type TransactionFields } from '../../database/models/transaction-model.js';
import { SyncStateModel, type SyncStateDoc, type SyncStateFields } from '../../database/models/sync-state-model.js';
import { BlockModel, type BlockStats, type BlockFields } from '../../database/models/block-model.js';
import { DelegationFlowModel, ContractActivityModel, TokenModel } from '../../database/models/index.js';
import { QueueService } from '../../services/queue.service.js';
import { blockchainConfig } from '../../config/blockchain.js';
import { TronGridClient, type TronGridBlock, type TronGridTransaction, type TronGridTransactionInfo } from './tron-grid.client.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../config/env.js';
import { getRedisClient } from '../../loaders/redis.js';
import { NotificationService } from '../../services/notification.service.js';
import { AlertService } from '../../services/alert.service.js';
import { PriceService } from '../../services/price.service.js';
import { AddressInsightService } from '../../services/address-insight.service.js';
import { ObserverRegistry } from './observers/ObserverRegistry.js';

const observerRegistryLogger = logger.child({ module: 'observer-registry' });

/**
 * Job data for queuing individual block processing tasks.
 * Each job represents a single blockchain block that needs to be fetched, parsed, and persisted.
 */
interface BlockSyncJob {
    blockNumber: number;
}

// Re-export types from @tronrelic/types for backward compatibility
export type TransactionCategoryFlags = ITransactionCategoryFlags;
export type TransactionPersistencePayload = ITransactionPersistencePayload;
// ProcessedTransaction is now a class, imported directly from @tronrelic/types

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
 * Provides block-level data needed to enrich individual transactions with USD prices and relationship graphs.
 */
interface TransactionBuildContext {
    priceUSD: number | null;
    addressGraph: Map<string, Set<string>>;
    blockTime: Date;
}


type TransactionType = TransactionDoc['type'];
type TransactionAddress = TransactionDoc['from'];
type TransactionContract = TransactionDoc['contract'];
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
 */
export class BlockchainService {
    private static instance: BlockchainService | null = null;

    private readonly redis: RedisClient;
    private readonly queue: QueueService<BlockSyncJob>;
    private readonly tronClient = TronGridClient.getInstance();
    private readonly notifications = new NotificationService();
    private readonly lockToken = randomUUID();
    private readonly alerts = new AlertService(this.tronClient);
    private readonly priceService = PriceService.getInstance();
    private readonly addressInsights = new AddressInsightService();
    private readonly observerRegistry = ObserverRegistry.getInstance(observerRegistryLogger);

    /**
     * Initialize the blockchain service with required dependencies and configure the block processing queue.
     *
     * This private constructor ensures singleton usage through getInstance(). It sets up a BullMQ worker that processes one block at a time
     * with a 2-minute lock duration to handle transaction-heavy blocks, delegates retry logic entirely to the TronGrid client to avoid
     * double-retry overhead, and configures job cleanup to prevent unbounded Redis memory growth from completed jobs.
     */
    private constructor() {
        this.redis = getRedisClient();
        this.queue = new QueueService<BlockSyncJob>(
            'block-sync',
            async job => {
                await this.processBlock(job.data.blockNumber);
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
     * Log corrupt block data for offline debugging.
     *
     * When block parsing fails due to malformed TronGrid responses, this method preserves the raw JSON in a dedicated log file
     * so engineers can analyze edge cases without blocking the sync process. This keeps blockchain ingestion resilient while
     * maintaining a paper trail for data quality issues that need investigation.
     */
    private logCorruptBlock(blockNumber: number, block: unknown, error: string) {
        try {
            const logPath = join(process.cwd(), '.run', 'backend_corrupt_block.log');
            const timestamp = new Date().toISOString();
            const logEntry = {
                timestamp,
                blockNumber,
                error,
                rawBlock: block
            };
            const logLine = JSON.stringify(logEntry, null, 2) + '\n' + '='.repeat(80) + '\n';
            appendFileSync(logPath, logLine, 'utf8');
            logger.warn({ blockNumber, logPath }, 'Corrupt block data written to log file');
        } catch (logError) {
            logger.error({ logError, blockNumber }, 'Failed to write corrupt block to log file');
        }
    }

    /**
     * Log corrupt transaction data for offline analysis.
     *
     * When individual transaction parsing fails within an otherwise valid block, this method captures the raw transaction payload
     * and error details without halting the entire block sync. By isolating bad transactions while continuing to process the rest,
     * we prevent single malformed records from stalling blockchain ingestion entirely.
     */
    private logCorruptTransaction(blockNumber: number, transaction: TronGridTransaction, error: unknown) {
        try {
            const cwd = normalize(process.cwd());
            let searchDir = cwd;
            let rootDir = cwd;
            while (true) {
                const packagePath = join(searchDir, 'package.json');
                if (existsSync(packagePath)) {
                    try {
                        const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as { workspaces?: unknown };
                        if (packageJson?.workspaces) {
                            rootDir = searchDir;
                            break;
                        }
                    } catch (parseError) {
                        logger.warn({ packagePath, parseError }, 'Failed to parse package.json while determining project root');
                    }
                }
                const parent = dirname(searchDir);
                if (parent === searchDir) {
                    break;
                }
                searchDir = parent;
            }
            const logDir = join(rootDir, '.run');
            mkdirSync(logDir, { recursive: true });
            const logPath = join(logDir, 'backend_corrupt_transaction.log');
            const timestamp = new Date().toISOString();
            const logEntry = {
                timestamp,
                blockNumber,
                txId: transaction?.txID,
                error:
                    error instanceof Error
                        ? { message: error.message, stack: error.stack }
                        : error,
                rawTransaction: transaction
            };
            const logLine = JSON.stringify(logEntry, null, 2) + '\n' + '='.repeat(80) + '\n';
            appendFileSync(logPath, logLine, 'utf8');
            logger.warn({ blockNumber, txId: transaction?.txID, logPath }, 'Corrupt transaction data written to log file');
        } catch (logError) {
            logger.error({ blockNumber, logError }, 'Failed to write corrupt transaction to log file');
        }
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
        return TransactionModel.find().sort({ timestamp: -1 }).limit(limit).lean() as Promise<TransactionFields[]>;
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
     * @param days - Number of days of history to retrieve (min 1, max 90, clamped automatically)
     * @returns Array of timeseries points sorted chronologically
     * @throws ValidationError if days parameter is invalid
     */
    async getTransactionTimeseries(days: number) {
        if (!Number.isFinite(days) || days <= 0) {
            throw new Error('Days must be a positive number');
        }

        const clampedDays = Math.min(Math.max(days, 1), 90);
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

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const results = await BlockModel.aggregate<AggregationResult>(pipeline as any);

        return results.map(row => {
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
     * Load the current blockchain sync cursor from MongoDB.
     * Returns the last successfully processed block number and backfill queue, or null if this is a fresh install.
     */
    private async getSyncState(): Promise<SyncStateFields | null> {
        return SyncStateModel.findOne({ key: 'blockchain:last-block' }).lean() as Promise<SyncStateFields | null>;
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
            const latestBlock = await this.tronClient.getNowBlock();
            const latestNetworkBlock = latestBlock.block_header.raw_data.number;
            const lastProcessed = this.getLastProcessedBlock(state, latestNetworkBlock);
            const parityTarget = this.getParityTarget(state);
            const existingBackfill = this.getBackfillQueue(state);

            const { targets, remainingBackfill } = await this.computeBlockTargets({
                lastProcessed,
                latestNetworkBlock,
                parityTarget,
                existingBackfill
            });

            if (!targets.length) {
                logger.debug({ lastProcessed, latestNetworkBlock }, 'No new blocks to schedule');
                await SyncStateModel.updateOne(
                    { key: 'blockchain:last-block' },
                    {
                        $set: {
                            'meta.lastNetworkHeight': latestNetworkBlock,
                            'meta.lastScheduledAt': new Date(),
                            'meta.backfillQueue': remainingBackfill
                        }
                    },
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

            for (const blockNumber of eligibleTargets) {
                await this.queue.enqueue(
                    'sync-block',
                    { blockNumber },
                    {
                        jobId: `block-${blockNumber}`
                        // No attempts/backoff config - use queue defaults (single attempt, TronGrid handles retries)
                    }
                );
            }

            await SyncStateModel.updateOne(
                { key: 'blockchain:last-block' },
                {
                    $setOnInsert: { cursor: { blockNumber: lastProcessed } },
                    $set: {
                        'meta.backfillQueue': remainingBackfill,
                        'meta.lastNetworkHeight': latestNetworkBlock,
                        'meta.lastScheduledAt': new Date(),
                        'meta.lastBatchSize': targets.length
                    },
                    $unset: {
                        'meta.lastError': '',
                        'meta.lastErrorAt': ''
                    }
                },
                { upsert: true }
            );

            const lag = latestNetworkBlock - lastProcessed;
            if (lag > blockchainConfig.maxNetworkLagBeforeBackoff) {
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
                await SyncStateModel.updateOne(
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
        if (!state?.cursor) {
            // On fresh install, start from current block instead of 0
            logger.info({ latestNetworkBlock }, 'Fresh install detected, starting sync from current block');
            return latestNetworkBlock;
        }

        const cursor = state.cursor as Record<string, unknown>;
        const value = cursor.blockNumber;

        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }

        if (typeof value === 'string') {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) {
                return parsed;
            }
        }

        return latestNetworkBlock;
    }

    /**
     * Calculate which blocks to schedule for processing in this scheduler run.
     *
     * Prioritizes backfill queue entries (missed/failed blocks) before advancing the main cursor to ensure gap-free historical data.
     * Respects the configured batch size limit to prevent queue flooding, and includes parity target blocks when configured to align
     * with external system requirements. Returns both the blocks to process immediately and the remaining backfill queue for future runs.
     */
    private async computeBlockTargets(params: {
        lastProcessed: number;
        latestNetworkBlock: number;
        parityTarget: number | null;
        existingBackfill: number[];
    }): Promise<{ targets: number[]; remainingBackfill: number[] }> {
        const { lastProcessed, latestNetworkBlock, parityTarget, existingBackfill } = params;
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

        let nextBlock = lastProcessed + 1;
        while (selected.size < maxBatch && nextBlock <= latestNetworkBlock) {
            if (!selected.has(nextBlock)) {
                selected.add(nextBlock);
                targets.push(nextBlock);
            }
            nextBlock += 1;
        }

        if (parityTarget && parityTarget > lastProcessed) {
            let parityBlock = lastProcessed + 1;
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
        const existing = await BlockModel.find({
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
     * When caught up to the live chain (within 100 blocks of current network height), processing is throttled to 3-second intervals
     * to simulate live blockchain timing on the frontend, creating a stable real-time experience even when processing historical data.
     */
    private async processBlock(blockNumber: number) {
        logger.info({ blockNumber }, 'Processing blockchain block');

        try {
            // Check if we should throttle to simulate live chain experience
            const latestBlock = await this.tronClient.getNowBlock();
            const latestNetworkBlock = latestBlock.block_header.raw_data.number;
            const blocksBehind = latestNetworkBlock - blockNumber;
            const isCaughtUp = blocksBehind <= blockchainConfig.network.liveChainThrottleBlocks;

            if (isCaughtUp) {
                const throttleMs = blockchainConfig.network.blockIntervalSeconds * 1000;
                logger.debug({ blockNumber, blocksBehind, throttleMs }, 'Throttling block processing to simulate live chain timing');
                await new Promise(resolve => setTimeout(resolve, throttleMs));
            } else {
                logger.debug({ blockNumber, blocksBehind }, 'Processing block without throttle - catching up to chain head');
            }

            // Fetch block from TronGrid - if this fails, error goes to catch block below
            const block = await this.tronClient.getBlockByNumber(blockNumber);

            // Validate block structure before proceeding
            if (!block?.block_header?.raw_data?.timestamp) {
                this.logCorruptBlock(blockNumber, block, 'Missing timestamp in block structure');
                throw new Error(`Invalid block structure returned from TronGrid API for block ${blockNumber} - missing timestamp`);
            }

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
                this.logCorruptBlock(blockNumber, block, `Invalid timestamp value: ${block.block_header.raw_data.timestamp}`);
                throw new Error(`Invalid timestamp in block ${blockNumber}: ${block.block_header.raw_data.timestamp} (${dateError instanceof Error ? dateError.message : String(dateError)})`);
            }
            const priceUSD = await this.priceService.getTrxPriceUsd();
            const addressGraph = new Map<string, Set<string>>();

            const buildContext: TransactionBuildContext = {
                priceUSD,
                addressGraph,
                blockTime
            };

            // Note: We don't fetch transaction info for every transaction like the old system
            // All necessary data (amounts, addresses, types, memos) is already in the block response
            // Transaction info (energy/bandwidth metrics, internal txs) would require 1 API call per tx
            // For a block with 200 transactions, that's 200 extra API calls vs 0 with current approach
            const processed: ProcessedTransaction[] = [];
            const operations: AnyBulkWriteOperation<TransactionDoc>[] = [];

            for (const transaction of transactions) {
                try {
                    // Pass null for info - energy/bandwidth metrics will be undefined, but all core data is available
                    const result = this.buildTransactionRecord(block, transaction, null, buildContext);
                    if (!result) {
                        continue;
                    }

                    processed.push(result);
                    operations.push({
                        updateOne: {
                            filter: { txId: result.payload.txId },
                            update: { $set: result.payload },
                            upsert: true
                        }
                    });

                    // Notify observers of the processed transaction
                    await this.observerRegistry.notifyTransaction(result);
                } catch (transactionError) {
                    this.logCorruptTransaction(blockNumber, transaction, transactionError);
                }
            }

            if (operations.length) {
                await TransactionModel.bulkWrite(operations, { ordered: false });
            }

            const stats = this.calculateBlockStats(processed);

            await BlockModel.updateOne(
                { blockNumber },
                {
                    $set: {
                        blockId: block.blockID,
                        parentHash: block.block_header.raw_data.parentHash,
                        witnessAddress: TronGridClient.toBase58Address(block.block_header.raw_data.witness_address) ?? 'unknown',
                        timestamp: new Date(block.block_header.raw_data.timestamp),
                        transactionCount: transactions.length,
                        size: block.size,
                        stats,
                        processedAt: new Date()
                    }
                },
                { upsert: true }
            );

            await SyncStateModel.updateOne(
                { key: 'blockchain:last-block' },
                {
                    $setOnInsert: {
                        cursor: { blockNumber }
                    }
                },
                { upsert: true }
            );

            await SyncStateModel.updateOne(
                { key: 'blockchain:last-block' },
                {
                    $max: {
                        'cursor.blockNumber': blockNumber
                    },
                    $set: {
                        'meta.lastProcessedAt': new Date(),
                        'meta.lastProcessedBlockId': block.blockID
                    },
                    $pull: { 'meta.backfillQueue': blockNumber }
                }
            );

            await this.emitSocketEvents(blockNumber, block, stats, processed);
            await this.alerts.ingestTransactions(processed.map(transaction => transaction.payload));
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

            await SyncStateModel.updateOne(
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
     * block context, enriches sender and receiver addresses with exchange/wallet labels, extracts memos and contract details, builds
     * resource consumption metrics, and constructs a relationship graph connecting addresses within the block. The resulting ProcessedTransaction
     * provides a complete, framework-independent view of the transaction that observers and the database layer can consume without touching
     * raw TronGrid responses, making future blockchain provider swaps easier.
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

        const contractType = this.normalizeContractType(contract.type);
        const value = (contract.parameter?.value ?? {}) as Record<string, unknown>;

        const timestamp = new Date(context.blockTime.getTime());
        const blockNumber = block.block_header.raw_data.number;

        const ownerAddress = TronGridClient.toBase58Address(value.owner_address as string) ?? 'unknown';
        const recipientAddress = this.resolveRecipient(contractType, value, ownerAddress);

        const { rawAmountSun, amountTRX } = this.resolveAmounts(contractType, value);
        const amountUSD = context.priceUSD ? Number((amountTRX * context.priceUSD).toFixed(2)) : undefined;

        const memo = TronGridClient.decodeMemo(transaction.raw_data.data);
        const internalTransactions = info?.internal_transactions ?? [];

        const energyMetrics = this.buildEnergyMetrics(info);
        const bandwidthMetrics = this.buildBandwidthMetrics(info);

        const fromInsight = this.addressInsights.enrich(ownerAddress);
        const toInsight = this.addressInsights.enrich(recipientAddress);

        const payload: TransactionPersistencePayload = {
            txId: transaction.txID,
            blockNumber,
            timestamp,
            type: contractType,
            subType: typeof value.resource === 'string' ? (value.resource as string) : undefined,
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
            contract: this.describeContract(contractType, value),
            memo,
            internalTransactions,
            notifications: [],
            analysis: {
                pattern: 'unknown'
            }
        };

        const relatedTransactions = this.resolveRelatedTransactions(context.addressGraph, payload.txId, [ownerAddress, recipientAddress]);

        // Build analysis with related addresses and transactions
        const relatedAddresses = new Set<string>(
            [ownerAddress, recipientAddress].filter(address => address && address !== 'unknown')
        );

        payload.analysis = {
            ...(payload.analysis ?? {}),
            relatedTransactions,
            relatedAddresses: Array.from(relatedAddresses).slice(0, 50)
        };

        payload.analysis.clusterId = this.deriveClusterId(payload, relatedTransactions, context.blockTime);

        const snapshot = this.toSnapshot(payload);

        // Categories are now computed dynamically via ProcessedTransaction methods
        const emptyCategories: TransactionCategoryFlags = {
            isDelegation: false,
            isStake: false,
            isTokenCreation: false
        };

        const rawTransaction: ITransaction = { payload, snapshot, categories: emptyCategories, rawValue: value, info };

        return new ProcessedTransaction(rawTransaction);
    }

    /**
     * Build a list of related transactions by tracking address reuse within the block.
     *
     * Maintains an in-memory graph of addresses to transaction IDs, allowing detection of chained activity like exchange shuffles or
     * arbitrage sequences. When the same address appears in multiple transactions within a block, those transactions are linked together
     * for pattern analysis, capped at 25 relationships per transaction to prevent unbounded growth on high-volume addresses.
     */
    private resolveRelatedTransactions(
        addressGraph: Map<string, Set<string>>,
        txId: string,
        participants: string[]
    ): string[] {
        const related = new Set<string>();

        for (const participant of participants) {
            if (!participant || participant === 'unknown') {
                continue;
            }

            const existing = addressGraph.get(participant);

            if (existing) {
                existing.forEach(id => {
                    if (id !== txId) {
                        related.add(id);
                    }
                });
                existing.add(txId);
            } else {
                addressGraph.set(participant, new Set([txId]));
            }
        }

        return Array.from(related).slice(0, 25);
    }

    /**
     * Derive a cluster ID for grouping related transactions across multiple blocks.
     * Currently a placeholder that returns existing cluster IDs. Future implementation could use graph algorithms to identify whale activity clusters or exchange flow patterns.
     */
    private deriveClusterId(
        payload: TransactionPersistencePayload,
        relatedTransactions: string[],
        blockTime: Date
    ): string | undefined {
        return payload.analysis?.clusterId;
    }

    /**
     * Extract the recipient address from a transaction based on contract type.
     *
     * Different contract types store the recipient in different fields - TransferContract uses to_address, TriggerSmartContract uses contract_address,
     * delegation uses receiver_address, and so on. This method normalizes that variation so downstream code always has a consistent recipient field
     * regardless of transaction type, falling back to the sender address for self-directed transactions like stake operations.
     */
    private resolveRecipient(contractType: TransactionType, value: Record<string, unknown>, fallback: string): string {
        const candidates: Array<string | null | undefined> = [];

        switch (contractType) {
            case 'TransferContract':
            case 'TransferAssetContract':
                candidates.push(value.to_address as string);
                break;
            case 'TriggerSmartContract':
                candidates.push(value.contract_address as string);
                break;
            case 'DelegateResourceContract':
            case 'UnDelegateResourceContract':
                candidates.push(value.receiver_address as string);
                break;
            case 'FreezeBalanceContract':
            case 'FreezeBalanceV2Contract':
            case 'UnfreezeBalanceContract':
                candidates.push(value.receiver_address as string);
                break;
            default:
                candidates.push(value.to_address as string);
        }

        for (const candidate of candidates) {
            const address = TronGridClient.toBase58Address(candidate ?? undefined);
            if (address) {
                return address;
            }
        }

        return fallback;
    }

    /**
     * Extract transaction amounts from contract parameters based on transaction type.
     *
     * Amount fields vary by contract type - TransferContract uses 'amount', TriggerSmartContract uses 'call_value', delegation uses 'balance', and so on.
     * This method normalizes those differences and handles both string and numeric values from TronGrid, returning amounts in both sun (atomic units)
     * and TRX (human-readable) formats for consistent downstream handling.
     */
    private resolveAmounts(contractType: TransactionType, value: Record<string, unknown>) {
        let rawAmountSun = 0;

        const extract = (field: string) => {
            const val = value[field];
            if (typeof val === 'number') {
                return val;
            }
            if (typeof val === 'string') {
                const parsed = Number(val);
                return Number.isFinite(parsed) ? parsed : 0;
            }
            return 0;
        };

        switch (contractType) {
            case 'TransferContract':
                rawAmountSun = extract('amount');
                break;
            case 'TriggerSmartContract':
                rawAmountSun = extract('call_value');
                break;
            case 'DelegateResourceContract':
            case 'UnDelegateResourceContract':
                rawAmountSun = extract('balance');
                break;
            case 'FreezeBalanceContract':
            case 'FreezeBalanceV2Contract':
            case 'UnfreezeBalanceContract':
                rawAmountSun = extract('frozen_balance') || extract('amount');
                break;
            default:
                rawAmountSun = extract('amount');
        }

        const amountTRX = rawAmountSun / 1_000_000;
        return { rawAmountSun, amountTRX };
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
     * Build a structured contract description with method name and relevant parameters.
     *
     * Extracts contract-specific details based on transaction type - for TransferContract it captures the recipient and amount, for TriggerSmartContract
     * it decodes the method selector from calldata, for delegation it includes resource type and balance, and so on. This normalization provides a
     * consistent contract representation across different transaction types so observers and analytics code don't need transaction-specific parsing logic.
     */
    private describeContract(contractType: TransactionType, value: Record<string, unknown>): TransactionContract {
        switch (contractType) {
            case 'TransferContract':
                return {
                    address: TronGridClient.toBase58Address(value.to_address as string) ?? 'unknown',
                    method: 'transfer',
                    parameters: {
                        amountTRX: this.resolveAmounts(contractType, value).amountTRX
                    }
                };
            case 'TriggerSmartContract': {
                const data = typeof value.data === 'string' ? value.data : '';
                const method = data?.length >= 8 ? `0x${data.slice(0, 8)}` : undefined;
                return {
                    address: TronGridClient.toBase58Address(value.contract_address as string) ?? 'unknown',
                    method,
                    parameters: {
                        rawData: data,
                        callValueTRX: this.resolveAmounts(contractType, value).amountTRX
                    }
                };
            }
            case 'DelegateResourceContract':
                return {
                    address: TronGridClient.toBase58Address(value.receiver_address as string) ?? 'unknown',
                    method: 'delegateResource',
                    parameters: {
                        resource: value.resource,
                        balanceTRX: this.resolveAmounts(contractType, value).amountTRX
                    }
                };
            case 'FreezeBalanceContract':
            case 'FreezeBalanceV2Contract':
                return {
                    address: TronGridClient.toBase58Address(value.receiver_address as string) ?? 'unknown',
                    method: 'freezeBalance',
                    parameters: {
                        resource: value.resource,
                        duration: value.frozen_duration,
                        balanceTRX: this.resolveAmounts(contractType, value).amountTRX
                    }
                };
            case 'UnfreezeBalanceContract':
                return {
                    address: TronGridClient.toBase58Address(value.receiver_address as string) ?? 'unknown',
                    method: 'unfreezeBalance',
                    parameters: {
                        resource: value.resource
                    }
                };
            case 'AssetIssueContract':
                return {
                    address: TronGridClient.toBase58Address(value.owner_address as string) ?? 'unknown',
                    method: 'assetIssue',
                    parameters: {
                        name: value.name,
                        abbr: value.abbr,
                        totalSupply: value.total_supply
                    }
                };
            default:
                return {
                    address: TronGridClient.toBase58Address(value.contract_address as string) ?? 'unknown',
                    method: contractType,
                    parameters: value
                };
        }
    }

    /**
     * Map raw TronGrid contract type strings to normalized transaction types.
     * Ensures consistent type names across the application by validating against a known list, defaulting to 'Unknown' for unrecognized contract types.
     */
    private normalizeContractType(rawType: string | undefined): TransactionType {
        const knownTypes: TransactionType[] = [
            'TransferContract',
            'TransferAssetContract',
            'TriggerSmartContract',
            'ParticipateAssetIssueContract',
            'FreezeBalanceContract',
            'FreezeBalanceV2Contract',
            'UnfreezeBalanceContract',
            'DelegateResourceContract',
            'UnDelegateResourceContract',
            'VoteWitnessContract',
            'AssetIssueContract',
            'CreateSmartContract',
            'Unknown'
        ];

        if (rawType && knownTypes.includes(rawType as TransactionType)) {
            return rawType as TransactionType;
        }

        return 'Unknown';
    }


    /**
     * Broadcast real-time block completion events to connected WebSocket clients.
     *
     * Emits block:new events with aggregate statistics so the frontend can display live sync progress and transaction volume metrics.
     * Individual transaction events are handled by plugins via the observer pattern rather than centralized here.
     */
    private async emitSocketEvents(
        blockNumber: number,
        block: TronGridBlock,
        stats: BlockStats,
        processed: ProcessedTransaction[]
    ) {
        const blockTimestamp = new Date(block.block_header.raw_data.timestamp);

        await this.notifications.broadcast({
            event: 'block:new',
            payload: {
                blockNumber,
                timestamp: blockTimestamp.toISOString(),
                stats: {
                    ...stats,
                    transactions: processed.length
                }
            }
        });
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
