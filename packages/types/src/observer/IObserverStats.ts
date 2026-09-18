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

    // Optional batch observer metrics (only present for batch observers)
    /** Total number of batches processed (batch observers only) */
    batchesProcessed?: number;
    /** Average number of transactions per batch (batch observers only) */
    avgBatchSize?: number;
    /** Maximum batch size observed (batch observers only) */
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
