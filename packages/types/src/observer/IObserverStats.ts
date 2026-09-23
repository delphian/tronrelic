/**
 * Statistics tracked for each observer instance.
 *
 * Provides monitoring data for performance analysis and debugging observer behavior.
 * These metrics are collected automatically by the BaseObserver and exposed through
 * the BlockchainObserverService for system-wide monitoring.
 */
export interface IObserverStats {
    /** Observer name for identification */
    name: string;
    /** Current number of transactions waiting in queue */
    queueDepth: number;
    /** Total number of transactions processed successfully */
    totalProcessed: number;
    /** Total number of transactions that failed processing */
    totalErrors: number;
    /** Total number of transactions dropped due to queue overflow */
    totalDropped: number;
    /**
     * Average milliseconds of work this observer performs per block.
     *
     * Every observer base class reports this in the same unit, so the figures
     * are comparable across a dashboard row even though the three base classes
     * are invoked at different granularities. A transaction observer sums the
     * time it spends on each transaction in a block and counts that as one
     * sample; a batch observer and a block observer each already run once per
     * block. Per block is the useful unit because it is what a reader compares
     * against TRON's block interval to judge whether an observer can keep up.
     *
     * Blocks in which the observer had no relevant work do not count, so this
     * is the cost of an active block rather than an average over the chain.
     */
    avgProcessingTimeMs: number;
    /** Lowest per-block processing time observed, in milliseconds */
    minProcessingTimeMs: number;
    /** Highest per-block processing time observed, in milliseconds */
    maxProcessingTimeMs: number;
    /** Timestamp of last successful processing */
    lastProcessedAt: string | null;
    /** Timestamp of last error */
    lastErrorAt: string | null;
    /** Current error rate (errors / total processed) */
    errorRate: number;

    /**
     * Most items the observer's queue holds before it starts dropping work:
     * transactions for a transaction observer, batches for a batch or event
     * observer, blocks for a block observer. Set by the base classes so the
     * console can judge `queueDepth` against the observer's own limit rather
     * than one fixed number for every kind.
     */
    queueCapacity?: number;

    /**
     * How the observer is subscribed, filled in by the observer registry rather
     * than the observer itself. `'transaction'` receives one transaction at a
     * time, `'batch'` a block's transactions grouped by type, `'block'` whole
     * blocks, and `'event'` matching contract events. Tells a reader what
     * `totalProcessed` counts.
     */
    kind?: 'transaction' | 'batch' | 'block' | 'event';

    /**
     * What the observer is subscribed to, as short labels filled in by the
     * registry: contract types for transaction and batch observers, `'every
     * block'` for block observers, and signature hashes (with the contract
     * count when filtered) for event observers.
     */
    subscriptions?: string[];

    // Optional batch observer metrics (only present for batch and event observers)
    /** Total number of batches processed (batch and event observers only) */
    batchesProcessed?: number;
    /**
     * Average batch size: transactions per batch for a batch observer, events
     * per batch for an event observer.
     */
    avgBatchSize?: number;
    /** Maximum batch size observed, in the same unit as `avgBatchSize` */
    maxBatchSize?: number;

    // Optional block observer metrics (only present for block observers)
    /**
     * Number of blocks this observer performed work for.
     *
     * Set by block observers, which are invoked once per block, and by
     * transaction observers, which derive it by counting the distinct blocks
     * their transactions arrived from. It is the divisor behind
     * `avgProcessingTimeMs`, so a reader can tell how many samples that average
     * rests on. Batch observers report the equivalent count as
     * `batchesProcessed` instead.
     */
    blocksProcessed?: number;
    /** Average number of transactions per block (block observers only) */
    avgTransactionsPerBlock?: number;
    /** Maximum transactions in a single block (block observers only) */
    maxTransactionsInBlock?: number;
}
