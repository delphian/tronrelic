import type { IBaseBlockObserver, IBlockData, IObserverStats, ISystemLogService } from '@tronrelic/types';

/**
 * Base class for block-level observers.
 *
 * Provides queue management with overflow protection for incoming block processing.
 * When the queue exceeds MAX_QUEUE_SIZE blocks, incoming blocks are dropped and logged
 * to prevent memory issues while preserving queued work. Observers should extend this class
 * and implement the abstract processBlock method to handle block-specific logic.
 *
 * Block observers receive entire blocks with all their transactions after processing completes,
 * enabling cross-transaction analysis, block-level metrics calculation, or operations that
 * benefit from seeing the complete block before acting.
 *
 * Automatically tracks performance metrics including processing time, queue depth, error rates,
 * and block-specific statistics like average transactions per block.
 */
export abstract class BaseBlockObserver implements IBaseBlockObserver {
    private static readonly MAX_QUEUE_SIZE = 50;
    private queue: IBlockData[] = [];
    private isProcessing = false;

    protected abstract readonly name: string;
    protected readonly logger: ISystemLogService;

    // Statistics tracking
    private totalProcessed = 0;
    private totalErrors = 0;
    private totalDropped = 0;
    private totalProcessingTimeMs = 0;
    private minProcessingTimeMs = Number.POSITIVE_INFINITY;
    private maxProcessingTimeMs = 0;
    private lastProcessedAt: Date | null = null;
    private lastErrorAt: Date | null = null;

    // Block-specific statistics
    private blocksProcessed = 0;
    private totalTransactionsInBlocks = 0;
    private maxTransactionsInBlock = 0;

    /**
     * Create a new block observer with injected logging.
     *
     * Observers rely on structured logging to surface queue backpressure and processing
     * failures. Injecting an ISystemLogService keeps the base class decoupled from the concrete
     * logging implementation while ensuring every observer shares consistent metadata.
     *
     * @param logger - Structured logger scoped to the observer instance for consistent telemetry
     */
    public constructor(logger: ISystemLogService) {
        this.logger = logger;
    }

    /**
     * Process a complete block.
     *
     * This method is called for each block after all its transactions have been processed.
     * Implementations should be idempotent and handle errors gracefully as failures do not
     * block blockchain processing. The method is async fire-and-forget - errors are logged
     * but not propagated.
     *
     * @param blockData - Block metadata and all enriched transactions from the block
     */
    protected abstract processBlock(blockData: IBlockData): Promise<void>;

    /**
     * Enqueue a single transaction for processing.
     *
     * For compatibility with IBaseObserver. Block observers primarily receive data via
     * enqueueBlock(), so this method is a no-op that logs a warning.
     *
     * @param transaction - The enriched transaction (ignored for block observers)
     */
    public async enqueue(_transaction: unknown): Promise<void> {
        this.logger.warn(
            { observer: this.name },
            'Block observer received individual transaction via enqueue() - use enqueueBlock() instead'
        );
    }

    /**
     * Enqueue a block for processing.
     *
     * Adds the block data to the internal queue and triggers processing if not already
     * running. If the queue exceeds MAX_QUEUE_SIZE blocks, the incoming block is dropped and
     * logged to prevent memory overflow while preserving existing queued work.
     *
     * @param blockData - Block metadata and all enriched transactions
     */
    public async enqueueBlock(blockData: IBlockData): Promise<void> {
        if (this.queue.length >= BaseBlockObserver.MAX_QUEUE_SIZE) {
            const droppedTransactions = blockData.transactionCount;
            this.totalDropped += droppedTransactions;

            this.logger.error(
                {
                    observer: this.name,
                    queueSize: this.queue.length,
                    droppedBlocks: 1,
                    droppedTransactions,
                    totalDropped: this.totalDropped
                },
                'Block observer queue overflow - dropping incoming block to prevent memory issues'
            );
            return;
        }

        this.queue.push(blockData);

        if (!this.isProcessing) {
            void this.processQueue();
        }
    }

    /**
     * Process all queued blocks serially.
     *
     * Continuously processes blocks from the queue until empty. Each block is processed
     * individually and errors are caught, logged, and ignored to ensure one failure doesn't stop
     * processing of subsequent blocks. This method uses async fire-and-forget semantics.
     *
     * Tracks processing time, error statistics, and block-specific metrics for monitoring.
     */
    private async processQueue(): Promise<void> {
        if (this.isProcessing) {
            return;
        }

        this.isProcessing = true;

        try {
            while (this.queue.length > 0) {
                const blockData = this.queue.shift();
                if (!blockData) {
                    continue;
                }

                const startTime = Date.now();
                try {
                    await this.processBlock(blockData);

                    // Track successful processing
                    const processingTimeMs = Date.now() - startTime;
                    this.totalProcessed += 1;
                    this.totalProcessingTimeMs += processingTimeMs;
                    this.minProcessingTimeMs = Math.min(this.minProcessingTimeMs, processingTimeMs);
                    this.maxProcessingTimeMs = Math.max(this.maxProcessingTimeMs, processingTimeMs);
                    this.lastProcessedAt = new Date();

                    // Track block-specific statistics
                    this.blocksProcessed += 1;
                    this.totalTransactionsInBlocks += blockData.transactionCount;
                    this.maxTransactionsInBlock = Math.max(this.maxTransactionsInBlock, blockData.transactionCount);
                } catch (error) {
                    // Track error
                    this.totalErrors += 1;
                    this.lastErrorAt = new Date();

                    this.logger.error(
                        {
                            observer: this.name,
                            blockNumber: blockData.blockNumber,
                            transactionCount: blockData.transactionCount,
                            error,
                            totalErrors: this.totalErrors,
                            errorRate: this.calculateErrorRate()
                        },
                        'Block observer failed to process block - continuing with next block'
                    );
                }
            }
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Calculate current error rate.
     * Returns the ratio of errors to total blocks processed.
     */
    private calculateErrorRate(): number {
        const total = this.blocksProcessed + this.totalErrors;
        if (total === 0) {
            return 0;
        }
        return Number((this.totalErrors / total).toFixed(4));
    }

    /**
     * Get the observer name.
     * Provides public access to the observer's name for logging and monitoring.
     */
    public getName(): string {
        return this.name;
    }

    /**
     * Get current statistics for this observer.
     *
     * Returns real-time metrics including queue depth, processing times, error rates,
     * throughput information, and block-specific statistics. This method is called by
     * the observer registry to aggregate statistics across all observers for monitoring
     * dashboards.
     */
    public getStats(): IObserverStats {
        const avgProcessingTimeMs = this.blocksProcessed > 0
            ? Number((this.totalProcessingTimeMs / this.blocksProcessed).toFixed(2))
            : 0;

        const minProcessingTimeMs = this.minProcessingTimeMs === Number.POSITIVE_INFINITY
            ? 0
            : this.minProcessingTimeMs;

        const avgTransactionsPerBlock = this.blocksProcessed > 0
            ? Number((this.totalTransactionsInBlocks / this.blocksProcessed).toFixed(2))
            : 0;

        return {
            name: this.name,
            queueDepth: this.queue.length,
            totalProcessed: this.totalProcessed,
            totalErrors: this.totalErrors,
            totalDropped: this.totalDropped,
            avgProcessingTimeMs,
            minProcessingTimeMs,
            maxProcessingTimeMs: this.maxProcessingTimeMs,
            lastProcessedAt: this.lastProcessedAt?.toISOString() ?? null,
            lastErrorAt: this.lastErrorAt?.toISOString() ?? null,
            errorRate: this.calculateErrorRate(),
            // Block-specific metrics
            blocksProcessed: this.blocksProcessed,
            avgTransactionsPerBlock,
            maxTransactionsInBlock: this.maxTransactionsInBlock
        };
    }
}
