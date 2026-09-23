/**
 * @fileoverview Base class for contract event observers.
 *
 * An event observer follows contract events (a token `Transfer`, a USDT
 * `Issue`) rather than transaction types, and receives each block's matching
 * events as one `IContractEventBatch`. The queueing, overflow protection, stop
 * behaviour, and statistics follow `BaseBatchObserver`, so an operator reads
 * the same figures for every observer kind on `/system`.
 *
 * @module backend/modules/blockchain/observers/BaseEventObserver
 */
import type { IBaseEventObserver, IContractEventBatch, IObserverStats, ISystemLogService } from '@/types';

/**
 * Base class for contract event observers.
 *
 * Holds up to `MAX_QUEUE_SIZE` batches, one per block. When the queue is full
 * the incoming batch is dropped and logged, which keeps memory bounded while
 * preserving work already queued. Subclasses implement `processEvents`.
 *
 * Batches flagging a block without receipts (`receiptsFetched: false`, no
 * events) are delivered to `processEvents` like any other, so the subclass can
 * record the gap, but they count toward neither `totalProcessed` nor the batch
 * size figures, because they carry no events.
 */
export abstract class BaseEventObserver implements IBaseEventObserver {
    private static readonly MAX_QUEUE_SIZE = 100;
    private queue: IContractEventBatch[] = [];
    private isProcessing = false;
    private stopped = false;

    protected abstract readonly name: string;
    protected readonly logger: ISystemLogService;

    private totalProcessed = 0;
    private totalErrors = 0;
    private totalDropped = 0;
    private totalProcessingTimeMs = 0;
    private minProcessingTimeMs = Number.POSITIVE_INFINITY;
    private maxProcessingTimeMs = 0;
    private lastProcessedAt: Date | null = null;
    private lastErrorAt: Date | null = null;

    private batchesProcessed = 0;
    private maxBatchSize = 0;

    /**
     * Create a new event observer with injected logging.
     *
     * Queue overflow and processing failures are reported through the logger,
     * so it is injected rather than created here to keep plugin metadata on
     * every line the observer writes.
     *
     * @param logger - Structured logger scoped to the observer instance
     */
    public constructor(logger: ISystemLogService) {
        this.logger = logger;
    }

    /**
     * Process one block's matching events.
     *
     * Called once per queued batch, in block order. Implementations should be
     * idempotent per `eventId`, because the backfill queue can deliver the same
     * block twice. Errors are caught, counted, and logged by the base class.
     *
     * @param batch - The block's matching events, or an empty batch with
     *                `receiptsFetched: false` marking a coverage gap
     */
    protected abstract processEvents(batch: IContractEventBatch): Promise<void>;

    /**
     * Accept a single transaction through the generic observer interface.
     *
     * Event observers receive events through `enqueueEvents()`, so a call here
     * means the observer was subscribed with the wrong method. It is logged
     * rather than thrown so a wiring mistake cannot break block dispatch.
     *
     * @param _transaction - Ignored.
     */
    public async enqueue(_transaction: unknown): Promise<void> {
        this.logger.warn(
            { observer: this.name },
            'Event observer received an individual transaction via enqueue() - subscribe with subscribeEventsBatch() instead'
        );
    }

    /**
     * Queue one block's matching events and start processing if idle.
     *
     * Drops the incoming batch when the queue is full and records its events
     * in `totalDropped`, so a slow observer loses new work rather than growing
     * without limit.
     *
     * @param batch - The block's matching events
     */
    public async enqueueEvents(batch: IContractEventBatch): Promise<void> {
        if (this.stopped) {
            return;
        }

        if (this.queue.length >= BaseEventObserver.MAX_QUEUE_SIZE) {
            this.totalDropped += batch.events.length;

            this.logger.error(
                {
                    observer: this.name,
                    queueSize: this.queue.length,
                    blockNumber: batch.blockNumber,
                    droppedEvents: batch.events.length,
                    totalDropped: this.totalDropped
                },
                'Event observer queue overflow - dropping incoming batch to prevent memory issues'
            );
            return;
        }

        this.queue.push(batch);

        if (!this.isProcessing) {
            void this.processQueue();
        }
    }

    /**
     * Process queued batches one at a time until the queue is empty.
     *
     * Each batch is isolated: a failure is counted and logged and the next
     * batch still runs. The stop flag is checked on every iteration, so a
     * disabled plugin stops writing immediately instead of draining a backlog.
     */
    private async processQueue(): Promise<void> {
        if (this.isProcessing) {
            return;
        }

        this.isProcessing = true;

        try {
            while (this.queue.length > 0) {
                if (this.stopped) {
                    this.queue = [];
                    break;
                }

                const batch = this.queue.shift();
                if (!batch) {
                    continue;
                }

                const eventCount = batch.events.length;
                const startTime = Date.now();
                try {
                    await this.processEvents(batch);

                    if (eventCount > 0) {
                        const processingTimeMs = Date.now() - startTime;
                        this.totalProcessed += eventCount;
                        this.totalProcessingTimeMs += processingTimeMs;
                        this.minProcessingTimeMs = Math.min(this.minProcessingTimeMs, processingTimeMs);
                        this.maxProcessingTimeMs = Math.max(this.maxProcessingTimeMs, processingTimeMs);
                        this.batchesProcessed += 1;
                        this.maxBatchSize = Math.max(this.maxBatchSize, eventCount);
                    }
                    this.lastProcessedAt = new Date();
                } catch (error) {
                    this.totalErrors += 1;
                    this.lastErrorAt = new Date();

                    this.logger.error(
                        {
                            observer: this.name,
                            blockNumber: batch.blockNumber,
                            eventCount,
                            error,
                            totalErrors: this.totalErrors,
                            errorRate: this.calculateErrorRate()
                        },
                        'Event observer failed to process batch - continuing with next batch'
                    );
                }
            }
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Share of batches that failed, for the `/system` observer table.
     *
     * @returns Failed batches divided by all attempted batches, to four decimal
     *          places, or 0 before any batch ran.
     */
    private calculateErrorRate(): number {
        const total = this.batchesProcessed + this.totalErrors;
        let rate = 0;

        if (total > 0) {
            rate = Number((this.totalErrors / total).toFixed(4));
        }

        return rate;
    }

    /**
     * Permanently stop this observer and discard its backlog.
     *
     * Unsubscribing stops new batches arriving, but queued batches would still
     * drain, so a disabled plugin would keep writing. Discarded events are
     * added to `totalDropped` so the final statistics stay honest. Idempotent;
     * re-enabling a plugin constructs a fresh observer instead of restarting
     * this one.
     */
    public stop(): void {
        if (this.stopped) {
            return;
        }

        this.stopped = true;

        const discardedBatches = this.queue.length;
        const discardedEvents = this.queue.reduce((sum, batch) => sum + batch.events.length, 0);
        this.totalDropped += discardedEvents;
        this.queue = [];

        this.logger.info(
            { observer: this.name, discardedBatches, discardedEvents, batchesProcessed: this.batchesProcessed },
            'Event observer stopped - no further batches will be processed'
        );
    }

    /**
     * Name used in logs and on the `/system` observer table.
     *
     * @returns The subclass's declared name.
     */
    public getName(): string {
        return this.name;
    }

    /**
     * Report this observer's queue and processing figures.
     *
     * Uses the same fields as the other observer kinds so the `/system` table
     * can show every observer in one list. `totalProcessed` counts events, and
     * `avgBatchSize` is events per block that had any.
     *
     * @returns The observer's current statistics.
     */
    public getStats(): IObserverStats {
        const avgProcessingTimeMs = this.batchesProcessed > 0
            ? Number((this.totalProcessingTimeMs / this.batchesProcessed).toFixed(2))
            : 0;
        const avgBatchSize = this.batchesProcessed > 0
            ? Number((this.totalProcessed / this.batchesProcessed).toFixed(2))
            : 0;

        return {
            name: this.name,
            queueDepth: this.queue.length,
            totalProcessed: this.totalProcessed,
            totalErrors: this.totalErrors,
            totalDropped: this.totalDropped,
            avgProcessingTimeMs,
            minProcessingTimeMs: this.minProcessingTimeMs === Number.POSITIVE_INFINITY ? 0 : this.minProcessingTimeMs,
            maxProcessingTimeMs: this.maxProcessingTimeMs,
            lastProcessedAt: this.lastProcessedAt?.toISOString() ?? null,
            lastErrorAt: this.lastErrorAt?.toISOString() ?? null,
            errorRate: this.calculateErrorRate(),
            queueCapacity: BaseEventObserver.MAX_QUEUE_SIZE,
            batchesProcessed: this.batchesProcessed,
            avgBatchSize,
            maxBatchSize: this.maxBatchSize
        };
    }
}
