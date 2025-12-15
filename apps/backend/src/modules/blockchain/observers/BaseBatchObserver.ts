import type { IBaseBatchObserver, IObserverStats, ISystemLogService, ITransaction } from '@tronrelic/types';

/**
 * Base class for batch transaction observers.
 *
 * Provides queue management with overflow protection for incoming transaction batch processing.
 * When the queue exceeds MAX_QUEUE_SIZE batches, incoming batches are dropped and logged
 * to prevent memory issues while preserving queued work. Observers should extend this class
 * and implement the abstract processBatch method to handle batch-specific logic.
 *
 * Batch observers receive all transactions of a subscribed type from a block at once, enabling
 * efficient bulk operations such as batch database inserts or aggregated analytics.
 *
 * Automatically tracks performance metrics including processing time, queue depth, error rates,
 * and batch-specific statistics like average batch size.
 */
export abstract class BaseBatchObserver implements IBaseBatchObserver {
    private static readonly MAX_QUEUE_SIZE = 100;
    private queue: ITransaction[][] = [];
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

    // Batch-specific statistics
    private batchesProcessed = 0;
    private totalTransactionsInBatches = 0;
    private maxBatchSize = 0;

    /**
     * Create a new batch observer with injected logging.
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
     * Process a batch of transactions.
     *
     * This method is called for each batch of transactions that matches the observer's
     * subscription criteria. Implementations should be idempotent and handle errors gracefully
     * as failures do not block blockchain processing. The method is async fire-and-forget -
     * errors are logged but not propagated.
     *
     * @param transactions - Array of enriched transactions of the subscribed type from a single block
     */
    protected abstract processBatch(transactions: ITransaction[]): Promise<void>;

    /**
     * Enqueue a single transaction for processing.
     *
     * For compatibility with IBaseObserver, but batch observers should primarily receive
     * transactions via enqueueBatch(). This method wraps the single transaction in an array.
     *
     * @param transaction - The enriched transaction to process
     */
    public async enqueue(transaction: ITransaction): Promise<void> {
        await this.enqueueBatch([transaction]);
    }

    /**
     * Enqueue a batch of transactions for processing.
     *
     * Adds the transaction array to the internal queue and triggers processing if not already
     * running. If the queue exceeds MAX_QUEUE_SIZE batches, the incoming batch is dropped and
     * logged to prevent memory overflow while preserving existing queued work.
     *
     * @param transactions - Array of enriched transactions to process as a batch
     */
    public async enqueueBatch(transactions: ITransaction[]): Promise<void> {
        if (this.queue.length >= BaseBatchObserver.MAX_QUEUE_SIZE) {
            const droppedTransactions = transactions.length;
            this.totalDropped += droppedTransactions;

            this.logger.error(
                {
                    observer: this.name,
                    queueSize: this.queue.length,
                    droppedBatches: 1,
                    droppedTransactions,
                    totalDropped: this.totalDropped
                },
                'Batch observer queue overflow - dropping incoming batch to prevent memory issues'
            );
            return;
        }

        this.queue.push(transactions);

        if (!this.isProcessing) {
            void this.processQueue();
        }
    }

    /**
     * Process all queued batches serially.
     *
     * Continuously processes batches from the queue until empty. Each batch is processed
     * individually and errors are caught, logged, and ignored to ensure one failure doesn't stop
     * processing of subsequent batches. This method uses async fire-and-forget semantics.
     *
     * Tracks processing time, error statistics, and batch-specific metrics for monitoring.
     */
    private async processQueue(): Promise<void> {
        if (this.isProcessing) {
            return;
        }

        this.isProcessing = true;

        try {
            while (this.queue.length > 0) {
                const batch = this.queue.shift();
                if (!batch || batch.length === 0) {
                    continue;
                }

                const startTime = Date.now();
                try {
                    await this.processBatch(batch);

                    // Track successful processing
                    const processingTimeMs = Date.now() - startTime;
                    this.totalProcessed += batch.length;
                    this.totalProcessingTimeMs += processingTimeMs;
                    this.minProcessingTimeMs = Math.min(this.minProcessingTimeMs, processingTimeMs);
                    this.maxProcessingTimeMs = Math.max(this.maxProcessingTimeMs, processingTimeMs);
                    this.lastProcessedAt = new Date();

                    // Track batch-specific statistics
                    this.batchesProcessed += 1;
                    this.totalTransactionsInBatches += batch.length;
                    this.maxBatchSize = Math.max(this.maxBatchSize, batch.length);
                } catch (error) {
                    // Track error
                    this.totalErrors += 1;
                    this.lastErrorAt = new Date();

                    this.logger.error(
                        {
                            observer: this.name,
                            batchSize: batch.length,
                            error,
                            totalErrors: this.totalErrors,
                            errorRate: this.calculateErrorRate()
                        },
                        'Batch observer failed to process batch - continuing with next batch'
                    );
                }
            }
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Calculate current error rate.
     * Returns the ratio of errors to total batches processed.
     */
    private calculateErrorRate(): number {
        const total = this.batchesProcessed + this.totalErrors;
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
     * throughput information, and batch-specific statistics. This method is called by
     * the observer registry to aggregate statistics across all observers for monitoring
     * dashboards.
     */
    public getStats(): IObserverStats {
        const avgProcessingTimeMs = this.batchesProcessed > 0
            ? Number((this.totalProcessingTimeMs / this.batchesProcessed).toFixed(2))
            : 0;

        const minProcessingTimeMs = this.minProcessingTimeMs === Number.POSITIVE_INFINITY
            ? 0
            : this.minProcessingTimeMs;

        const avgBatchSize = this.batchesProcessed > 0
            ? Number((this.totalTransactionsInBatches / this.batchesProcessed).toFixed(2))
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
            // Batch-specific metrics
            batchesProcessed: this.batchesProcessed,
            avgBatchSize,
            maxBatchSize: this.maxBatchSize
        };
    }
}
