import type { IBaseObserver } from './IBaseObserver.js';
import type { IObserverStats } from './IObserverStats.js';

/**
 * Interface for the blockchain observer service.
 *
 * The service manages observer registration and routes incoming transactions to subscribed
 * observers based on transaction type. This interface defines the public contract for
 * interacting with the service from plugins.
 */
export interface IBlockchainObserverService {
    /**
     * Subscribe an observer to a specific transaction type.
     *
     * Registers the observer to receive notifications when transactions of the specified type
     * are processed. Multiple observers can subscribe to the same transaction type, and each
     * will receive all matching transactions independently.
     *
     * @param transactionType - The transaction type to observe (e.g., 'TransferContract')
     * @param observer - The observer instance to notify when matching transactions occur
     */
    subscribeTransactionType(transactionType: string, observer: IBaseObserver): void;

    /**
     * Notify all subscribed observers of a new transaction.
     *
     * Routes the transaction to all observers that have subscribed to its type. Each observer
     * is notified asynchronously via fire-and-forget semantics.
     *
     * @param transaction - The enriched transaction to broadcast to subscribers
     */
    notifyTransaction(transaction: any): Promise<void>;

    /**
     * Get subscription statistics for monitoring.
     *
     * Returns a summary of all registered observers and their subscription counts by transaction type.
     */
    getSubscriptionStats(): Record<string, number>;

    /**
     * Get detailed performance statistics for all observers.
     *
     * Aggregates real-time metrics from all registered observers including queue depth,
     * processing times, error rates, and throughput.
     *
     * @returns Array of statistics objects, one per observer instance
     */
    getAllObserverStats(): IObserverStats[];

    /**
     * Get aggregated statistics across all observers.
     *
     * Provides system-wide metrics by combining data from all observers.
     */
    getAggregateStats(): {
        totalObservers: number;
        totalProcessed: number;
        totalErrors: number;
        totalDropped: number;
        totalQueueDepth: number;
        avgProcessingTimeMs: number;
        highestErrorRate: number;
        observersWithErrors: number;
    };
}
