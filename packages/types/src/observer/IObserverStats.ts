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
    /** Average processing time per transaction in milliseconds */
    avgProcessingTimeMs: number;
    /** Minimum processing time observed in milliseconds */
    minProcessingTimeMs: number;
    /** Maximum processing time observed in milliseconds */
    maxProcessingTimeMs: number;
    /** Timestamp of last successful processing */
    lastProcessedAt: string | null;
    /** Timestamp of last error */
    lastErrorAt: string | null;
    /** Current error rate (errors / total processed) */
    errorRate: number;
}
