import type { IObserverStats } from './IObserverStats.js';

/**
 * Interface for blockchain transaction observers.
 *
 * Observers subscribe to specific transaction types and process them asynchronously.
 * This interface defines the public contract that all observer implementations must satisfy,
 * allowing plugins to extend observers without importing concrete backend classes.
 */
export interface IBaseObserver {
    /**
     * Enqueue a transaction for processing.
     *
     * Adds the transaction to the internal queue and triggers processing if not already running.
     * If the queue exceeds the maximum size, the implementation should log an error and clear
     * the queue to prevent memory overflow.
     *
     * @param transaction - The enriched transaction to process
     */
    enqueue(transaction: any): Promise<void>;

    /**
     * Get the observer name.
     *
     * Provides public access to the observer's name for logging and monitoring.
     */
    getName(): string;

    /**
     * Get current statistics for this observer.
     *
     * Returns real-time metrics including queue depth, processing times, error rates,
     * and throughput information. This method is called by the observer registry
     * to aggregate statistics across all observers for monitoring dashboards.
     */
    getStats(): IObserverStats;
}
