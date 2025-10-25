import type { IBaseObserver, IObserverStats, ISystemLogService, ITransaction } from '@tronrelic/types';

/**
 * Base class for blockchain transaction observers.
 *
 * Provides queue management with overflow protection for incoming transaction processing.
 * When the queue exceeds MAX_QUEUE_SIZE, it automatically logs an error and clears itself
 * to prevent memory issues. Observers should extend this class and implement the abstract
 * process method to handle transaction-specific logic.
 *
 * Automatically tracks performance metrics including processing time, queue depth, and error rates.
 */
export abstract class BaseObserver implements IBaseObserver {
    private static readonly MAX_QUEUE_SIZE = 1000;
    private queue: ITransaction[] = [];
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

    /**
     * Create a new observer with injected logging.
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
     * Process a single transaction.
     *
     * This method is called for each transaction that matches the observer's subscription criteria.
     * Implementations should be idempotent and handle errors gracefully as failures do not block
     * blockchain processing. The method is async fire-and-forget - errors are logged but not propagated.
     *
     * @param transaction - The enriched transaction data from the blockchain service
     */
    protected abstract process(transaction: ITransaction): Promise<void>;

    /**
     * Enqueue a transaction for processing.
     *
     * Adds the transaction to the internal queue and triggers processing if not already running.
     * If the queue exceeds MAX_QUEUE_SIZE, logs an error and clears the queue to prevent memory overflow.
     * This is the public entry point called by the observer registry when matching transactions arrive.
     *
     * @param transaction - The enriched transaction to process
     */
    public async enqueue(transaction: ITransaction): Promise<void> {
        if (this.queue.length >= BaseObserver.MAX_QUEUE_SIZE) {
            const droppedCount = this.queue.length;
            this.totalDropped += droppedCount;

            this.logger.error(
                {
                    observer: this.name,
                    queueSize: this.queue.length,
                    droppedTransactions: droppedCount,
                    totalDropped: this.totalDropped
                },
                'Observer queue overflow - clearing queue to prevent memory issues'
            );
            this.queue = [];
        }

        this.queue.push(transaction);

        if (!this.isProcessing) {
            void this.processQueue();
        }
    }

    /**
     * Process all queued transactions serially.
     *
     * Continuously processes transactions from the queue until empty. Each transaction is processed
     * individually and errors are caught, logged, and ignored to ensure one failure doesn't stop
     * processing of subsequent transactions. This method uses async fire-and-forget semantics.
     *
     * Tracks processing time and error statistics for monitoring.
     */
    private async processQueue(): Promise<void> {
        if (this.isProcessing) {
            return;
        }

        this.isProcessing = true;

        try {
            while (this.queue.length > 0) {
                const transaction = this.queue.shift();
                if (!transaction) {
                    continue;
                }

                const startTime = Date.now();
                try {
                    await this.process(transaction);

                    // Track successful processing
                    const processingTimeMs = Date.now() - startTime;
                    this.totalProcessed += 1;
                    this.totalProcessingTimeMs += processingTimeMs;
                    this.minProcessingTimeMs = Math.min(this.minProcessingTimeMs, processingTimeMs);
                    this.maxProcessingTimeMs = Math.max(this.maxProcessingTimeMs, processingTimeMs);
                    this.lastProcessedAt = new Date();
                } catch (error) {
                    // Track error
                    this.totalErrors += 1;
                    this.lastErrorAt = new Date();

                    this.logger.error(
                        {
                            observer: this.name,
                            txId: transaction.payload.txId,
                            error,
                            totalErrors: this.totalErrors,
                            errorRate: this.calculateErrorRate()
                        },
                        'Observer failed to process transaction - continuing with next transaction'
                    );
                }
            }
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Calculate current error rate.
     * Returns the ratio of errors to total transactions processed.
     */
    private calculateErrorRate(): number {
        const total = this.totalProcessed + this.totalErrors;
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
     * and throughput information. This method is called by the observer registry
     * to aggregate statistics across all observers for monitoring dashboards.
     */
    public getStats(): IObserverStats {
        const avgProcessingTimeMs = this.totalProcessed > 0
            ? Number((this.totalProcessingTimeMs / this.totalProcessed).toFixed(2))
            : 0;

        const minProcessingTimeMs = this.minProcessingTimeMs === Number.POSITIVE_INFINITY
            ? 0
            : this.minProcessingTimeMs;

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
            errorRate: this.calculateErrorRate()
        };
    }
}
