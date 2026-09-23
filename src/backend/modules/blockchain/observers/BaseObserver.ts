import type { IBaseObserver, IObserverStats, ISystemLogService, ITransaction } from '@/types';

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
    private stopped = false;

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

    // Per-block timing. This class is invoked once per transaction, while the
    // batch and block observers are each invoked once per block, and all three
    // feed the same `avgProcessingTimeMs` column on the /system dashboard.
    // Reporting a per-transaction average here put two different units in that
    // column, so a busy observer looked hundreds of times slower than a quiet
    // one purely because more transactions per block landed on it. Summing a
    // block's transactions into one sample removes that, and per block is the
    // figure worth comparing against TRON's block interval anyway.
    private blocksSeen = 0;
    private currentBlockNumber: number | null = null;
    private currentBlockTimeMs = 0;

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
        if (this.stopped) {
            return;
        }

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
                // Re-checked every iteration, not just on entry: stop() can land while an
                // await above is in flight, and a long backlog would otherwise keep writing
                // for minutes after the owning plugin was disabled.
                if (this.stopped) {
                    this.queue = [];
                    break;
                }

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
                    this.lastProcessedAt = new Date();
                    this.accumulateBlockTime(transaction.payload.blockNumber, processingTimeMs);
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

            // The committer hands a whole block to observers without yielding, so
            // every transaction of a block is queued before this loop can empty.
            // An empty queue therefore means the block just worked on is complete,
            // and sealing it here keeps an idle or sparse observer's min and max
            // from waiting on a later block that may be a long time coming.
            this.sealCurrentBlock();
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Fold one transaction's processing time into the block it belongs to.
     *
     * The queue is first-in-first-out and sync notifies observers a whole block
     * at a time, so transactions arrive grouped by block and a change in block
     * number, or the queue draining, is a reliable boundary. That is what lets this class report a
     * per-block figure without sync having to tell it where a block ends.
     *
     * Blocks carrying no transaction this observer subscribes to never reach
     * the queue and so are never counted. The resulting average is therefore
     * the cost of a block that had relevant work, not an average across the
     * chain — which matches how the batch observer counts, since its own
     * pre-filter drops empty selections before they are enqueued.
     *
     * @param blockNumber The block the just-processed transaction came from,
     * used as the boundary marker rather than as a value worth storing.
     * @param processingTimeMs What this transaction cost, to be added to its
     * block's running total rather than recorded as a sample of its own.
     */
    private accumulateBlockTime(blockNumber: number, processingTimeMs: number): void {
        if (blockNumber !== this.currentBlockNumber) {
            this.sealCurrentBlock();
            this.currentBlockNumber = blockNumber;
            this.blocksSeen += 1;
        }

        this.currentBlockTimeMs += processingTimeMs;
    }

    /**
     * Close off the block being accumulated and record it as one timing sample.
     *
     * Min and max are only meaningful once a block is complete, so they are
     * updated here rather than per transaction. Callers are a change of block
     * number, the queue draining, and `stop()`. This must not be called from
     * `getStats()`: the dashboard polls while a block is still draining, and
     * sealing a partial block there would both understate the minimum and split
     * one block's cost across two samples.
     *
     * The current block number is cleared once the block is recorded, so a block
     * can only be sealed once and repeated calls do nothing. If more transactions
     * from the same block ever arrived after a seal, they would start a fresh
     * sample instead of adding to a total already written into min and max.
     */
    private sealCurrentBlock(): void {
        if (this.currentBlockNumber === null) {
            return;
        }

        this.minProcessingTimeMs = Math.min(this.minProcessingTimeMs, this.currentBlockTimeMs);
        this.maxProcessingTimeMs = Math.max(this.maxProcessingTimeMs, this.currentBlockTimeMs);
        this.currentBlockTimeMs = 0;
        this.currentBlockNumber = null;
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
     * Permanently stop this observer and discard its backlog.
     *
     * Unsubscribing an observer stops new work reaching it, but anything already queued would
     * still drain — so a disabled plugin would keep writing to its collections until the backlog
     * cleared. Dropping the queue here makes "disabled" mean stopped immediately. Counters are
     * deliberately preserved so the observer's final statistics stay readable, and the drop is
     * recorded against totalDropped so the discarded work is visible rather than silent.
     *
     * Idempotent: stopping an already-stopped observer does nothing. There is no restart —
     * re-enabling a plugin runs its init hook, which constructs a fresh observer.
     */
    public stop(): void {
        if (this.stopped) {
            return;
        }

        this.stopped = true;

        // Seal the block that was mid-flight so the observer's final min and max
        // include the last block it actually worked on. Nothing further will be
        // enqueued, so there is no later transaction to close it out.
        this.sealCurrentBlock();

        const discarded = this.queue.length;
        if (discarded > 0) {
            this.totalDropped += discarded;
            this.queue = [];
        }

        this.logger.info(
            {
                observer: this.name,
                discardedTransactions: discarded,
                totalProcessed: this.totalProcessed
            },
            discarded > 0
                ? 'Observer stopped - queue discarded, no further transactions will be processed'
                : 'Observer stopped - queue was empty, no further transactions will be processed'
        );
    }

    /**
     * Get current statistics for this observer.
     *
     * Returns real-time metrics including queue depth, processing times, error rates,
     * and throughput information. This method is called by the observer registry
     * to aggregate statistics across all observers for monitoring dashboards.
     *
     * Timing is reported per block rather than per transaction so that this
     * observer's figures mean the same thing as the batch and block observers'
     * on the same dashboard. This method deliberately does not seal the block
     * currently being processed — see `sealCurrentBlock` — so a block still
     * draining contributes its partial time to the average and is left out of
     * the minimum and maximum until it completes.
     */
    public getStats(): IObserverStats {
        const avgProcessingTimeMs = this.blocksSeen > 0
            ? Number((this.totalProcessingTimeMs / this.blocksSeen).toFixed(2))
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
            errorRate: this.calculateErrorRate(),
            queueCapacity: BaseObserver.MAX_QUEUE_SIZE,
            blocksProcessed: this.blocksSeen
        };
    }
}
