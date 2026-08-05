import type { IBaseObserver } from './IBaseObserver.js';
import type { IBaseBatchObserver } from './IBaseBatchObserver.js';
import type { IBaseBlockObserver } from './IBaseBlockObserver.js';
import type { IBlockData } from './IBlockData.js';
import type { IObserverStats } from './IObserverStats.js';
import type { ITransaction } from '../transaction/ITransaction.js';

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

    // Batch subscription methods

    /**
     * Subscribe a batch observer to one or more transaction types.
     *
     * Registers the observer to receive batched notifications containing all transactions
     * of the specified types from each block. Instead of receiving individual transactions,
     * the observer receives a single call with a record mapping transaction types to arrays
     * of matching transactions after the block completes processing.
     *
     * Observers receive exactly one callback per block containing all subscribed types that
     * had transactions. Empty types are omitted from the payload.
     *
     * @param transactionTypes - Array of transaction types to observe (e.g., ['DelegateResourceContract', 'UnDelegateResourceContract'])
     * @param observer - The batch observer instance to notify with transaction batches
     */
    subscribeTransactionTypesBatch(transactionTypes: string[], observer: IBaseBatchObserver): void;

    /**
     * Accumulate a transaction for batch notification.
     *
     * Called during block processing to collect transactions by type. After all transactions
     * in a block are processed, flushBatches() delivers accumulated transactions to batch
     * subscribers. This method is synchronous and fast - it only stores a reference.
     *
     * @param transaction - The enriched transaction to accumulate
     */
    accumulateForBatch(transaction: ITransaction): void;

    /**
     * Clear the batch accumulator.
     *
     * Called at the start of each block to reset the accumulator before processing
     * transactions. Ensures batch observers receive transactions from only one block.
     */
    clearBatchAccumulator(): void;

    /**
     * Flush accumulated batches to batch subscribers.
     *
     * Called after all transactions in a block have been processed and accumulated.
     * Delivers each transaction type's batch to subscribed batch observers using
     * fire-and-forget semantics.
     */
    flushBatches(): Promise<void>;

    // Block subscription methods

    /**
     * Subscribe a block observer to receive entire blocks.
     *
     * Registers the observer to receive complete block data including all enriched
     * transactions after each block finishes processing. Enables cross-transaction
     * analysis and block-level metrics calculation.
     *
     * @param observer - The block observer instance to notify with block data
     */
    subscribeBlock(observer: IBaseBlockObserver): void;

    /**
     * Notify all block subscribers of a completed block.
     *
     * Called after block processing completes with the full block data and all
     * enriched transactions. Uses fire-and-forget semantics to avoid blocking
     * the blockchain sync pipeline.
     *
     * @param blockData - Block metadata and all enriched transactions
     */
    notifyBlock(blockData: IBlockData): Promise<void>;

    /**
     * Get batch subscription statistics.
     *
     * Returns subscriber counts by transaction type for batch observers.
     */
    getBatchSubscriptionStats(): Record<string, number>;

    /**
     * Get block subscription statistics.
     *
     * Returns the count of block observers subscribed.
     */
    getBlockSubscriptionStats(): { subscriberCount: number };

    // Unsubscription methods

    /**
     * Unsubscribe an observer from a specific transaction type.
     *
     * Without this, an observer registered by a plugin keeps receiving transactions after the
     * plugin is disabled — it continues writing to its collections and emitting WebSocket events
     * for the lifetime of the process. Plugins are runtime-toggleable, so subscriptions must be
     * revocable.
     *
     * @param transactionType - The transaction type to stop observing
     * @param observer - The observer instance to remove from that type's subscriber set
     * @returns True if the observer was subscribed and has been removed, false if it was not
     */
    unsubscribeTransactionType(transactionType: string, observer: IBaseObserver): boolean;

    /**
     * Unsubscribe a batch observer from all transaction types it subscribed to.
     *
     * Batch observers register once for a set of types, so removal is all-or-nothing rather than
     * per-type — callers that registered via `subscribeTransactionTypesBatch` hold no per-type
     * handle to revoke individually.
     *
     * @param observer - The batch observer instance to remove
     * @returns True if the observer was subscribed and has been removed, false if it was not
     */
    unsubscribeTransactionTypesBatch(observer: IBaseBatchObserver): boolean;

    /**
     * Unsubscribe a block observer from block notifications.
     *
     * @param observer - The block observer instance to remove
     * @returns True if the observer was subscribed and has been removed, false if it was not
     */
    unsubscribeBlock(observer: IBaseBlockObserver): boolean;

    /**
     * Remove an observer from every subscription it holds, whatever its kind.
     *
     * The platform disables plugins without knowing how each of their observers registered, so
     * this sweeps all three collections (per-type, batch, block) in one call. Prefer it on
     * lifecycle teardown paths; use the targeted variants when revoking one known subscription.
     *
     * @param observer - The observer instance to remove from all subscriber collections
     * @returns Count of subscriptions removed — 0 means the observer held none
     */
    unsubscribeObserver(observer: IBaseObserver | IBaseBatchObserver | IBaseBlockObserver): number;
}
