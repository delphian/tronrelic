import type {
    IBlockchainObserverService,
    IBaseObserver,
    IBaseBatchObserver,
    IBaseBlockObserver,
    IBlockData,
    IObserverStats,
    ISystemLogService,
    ITransaction
} from '@tronrelic/types';

type TransactionType = ITransaction['payload']['type'];

/**
 * Blockchain Observer Service
 *
 * Central registry and notification system for blockchain transaction observers.
 * Manages observer registration and routes incoming transactions to subscribed observers
 * based on transaction type. Supports multiple observers per transaction type and provides
 * async fire-and-forget notification semantics where observer failures do not block processing.
 *
 * Why this exists:
 * This service decouples the blockchain sync pipeline from plugin-specific transaction processing.
 * Observers register for specific transaction types (TransferContract, DelegateResourceContract, etc.)
 * and receive enriched transaction data asynchronously without blocking the main sync flow. Observer
 * failures are isolated - one failing observer never affects others or stops blockchain synchronization.
 *
 * Architecture:
 * - Singleton service initialized during application bootstrap
 * - Observers register during plugin initialization via dependency-injected context
 * - BlockchainService notifies this service after enriching each transaction
 * - Async notification ensures blockchain sync throughput remains unaffected by observer load
 *
 * Performance characteristics:
 * - O(1) subscription lookup by transaction type (Map-based)
 * - Fire-and-forget notifications prevent observer backpressure
 * - Individual observer errors logged but do not propagate
 * - Statistics aggregation is O(n) where n = total registered observers
 */
export class BlockchainObserverService implements IBlockchainObserverService {
    private static instance: BlockchainObserverService | null = null;
    private logger: ISystemLogService;

    // Individual transaction subscribers (existing)
    private transactionTypeSubscribers = new Map<TransactionType, Set<IBaseObserver>>();

    // Batch subscribers - receive all transactions of a type from a block at once
    private batchTypeSubscribers = new Map<TransactionType, Set<IBaseBatchObserver>>();

    // Block subscribers - receive entire blocks with all transactions
    private blockSubscribers = new Set<IBaseBlockObserver>();

    // Batch accumulator - collects transactions by type during block processing
    private batchAccumulator = new Map<TransactionType, ITransaction[]>();

    /**
     * Initialize the blockchain observer service.
     *
     * Creates the singleton instance with dependency-injected logger for structured telemetry.
     * This constructor is private to enforce singleton usage through getInstance().
     *
     * @param logger - Structured logger for service telemetry and observer activity tracking
     */
    private constructor(logger: ISystemLogService) {
        this.logger = logger;
        this.logger.info('Blockchain observer service initialized');
    }

    /**
     * Get the singleton service instance.
     *
     * Returns the existing instance or throws if the service has not been initialized yet.
     * Services should be initialized during bootstrap before plugins load to ensure
     * dependency injection context is ready when plugins call getInstance().
     *
     * @returns The singleton service instance
     * @throws Error if service has not been initialized via initialize()
     */
    public static getInstance(): BlockchainObserverService {
        if (!BlockchainObserverService.instance) {
            throw new Error(
                'BlockchainObserverService not initialized. Call initialize(logger) during bootstrap before accessing getInstance()'
            );
        }

        return BlockchainObserverService.instance;
    }

    /**
     * Initialize the service singleton.
     *
     * Must be called once during application bootstrap before any plugins attempt to register
     * observers. Subsequent calls update the logger but preserve the existing instance.
     *
     * Why initialization is separate from getInstance:
     * This pattern allows bootstrap code to explicitly control when the service becomes available,
     * ensuring the logger is properly configured before any observer registration occurs. It also
     * makes the initialization order visible in bootstrap code rather than hidden in lazy getters.
     *
     * @param logger - Structured logger for service telemetry
     * @returns The singleton service instance
     */
    public static initialize(logger: ISystemLogService): BlockchainObserverService {
        if (!BlockchainObserverService.instance) {
            BlockchainObserverService.instance = new BlockchainObserverService(logger);
        } else {
            // Allow logger updates for testing or reconfiguration
            BlockchainObserverService.instance.logger = logger;
        }

        return BlockchainObserverService.instance;
    }

    /**
     * Subscribe an observer to a specific transaction type.
     *
     * Registers the observer to receive notifications when transactions of the specified type
     * are processed. Multiple observers can subscribe to the same transaction type, and each
     * will receive all matching transactions independently. Observers are invoked asynchronously
     * and failures do not affect other observers or block blockchain processing.
     *
     * Observers should subscribe during plugin initialization (in the init lifecycle hook) to
     * ensure they begin receiving transactions as soon as the plugin becomes active. Subscriptions
     * persist for the lifetime of the application - there is currently no unsubscribe mechanism
     * since plugins remain active until application restart.
     *
     * @param transactionType - The transaction type to observe (e.g., 'TransferContract')
     * @param observer - The observer instance to notify when matching transactions occur
     */
    public subscribeTransactionType(transactionType: string, observer: IBaseObserver): void {
        const subscribers = this.transactionTypeSubscribers.get(transactionType as TransactionType) ?? new Set();
        subscribers.add(observer);
        this.transactionTypeSubscribers.set(transactionType as TransactionType, subscribers);

        this.logger.info(
            {
                transactionType,
                observerName: observer.getName(),
                totalSubscribers: subscribers.size
            },
            'Observer subscribed to transaction type'
        );
    }

    /**
     * Notify all subscribed observers of a new transaction.
     *
     * Routes the transaction to all observers that have subscribed to its type. Each observer
     * is notified asynchronously via fire-and-forget semantics - this method returns immediately
     * and does not wait for observers to finish processing. Observer failures are logged but do
     * not propagate to the caller or affect other observers.
     *
     * Why fire-and-forget notification matters:
     * BlockchainService processes thousands of transactions per minute during sync. If we awaited
     * observer completion, slow observers (complex analytics, external API calls) would bottleneck
     * the entire blockchain pipeline. Fire-and-forget ensures sync throughput remains independent
     * of observer performance while still delivering every transaction reliably via observer queues.
     *
     * Error isolation:
     * If observer.enqueue() throws (queue overflow, internal bug), the error is logged with context
     * but does not fail the notification loop. Other observers continue to receive the transaction,
     * and blockchain sync proceeds unaffected. This prevents cascading failures from plugin bugs.
     *
     * @param transaction - The enriched transaction to broadcast to subscribers
     */
    public async notifyTransaction(transaction: ITransaction): Promise<void> {
        const subscribers = this.transactionTypeSubscribers.get(transaction.payload.type);

        if (!subscribers || subscribers.size === 0) {
            return;
        }

        // Fire and forget - don't wait for observers to complete
        const notifications = Array.from(subscribers).map(async observer => {
            try {
                await observer.enqueue(transaction);
            } catch (error) {
                this.logger.error(
                    {
                        observer: observer.getName(),
                        txId: transaction.payload.txId,
                        error
                    },
                    'Failed to enqueue transaction to observer'
                );
            }
        });

        // Don't await - fire and forget
        void Promise.all(notifications);
    }

    /**
     * Get subscription statistics for monitoring.
     *
     * Returns a summary of all registered observers and their subscription counts by transaction type.
     * Useful for debugging and monitoring to ensure observers are properly registered and to understand
     * the distribution of observers across different transaction types.
     *
     * Example output:
     * {
     *   "TransferContract": 2,
     *   "TriggerSmartContract": 3,
     *   "DelegateResourceContract": 1
     * }
     *
     * @returns Record mapping transaction types to subscriber counts
     */
    public getSubscriptionStats(): Record<string, number> {
        const stats: Record<string, number> = {};

        for (const [type, subscribers] of this.transactionTypeSubscribers.entries()) {
            stats[type] = subscribers.size;
        }

        return stats;
    }

    /**
     * Get aggregated statistics across all observers.
     *
     * Provides system-wide metrics by combining data from all observers. Useful for
     * high-level monitoring dashboards and capacity planning.
     *
     * Aggregated metrics include:
     * - Total observers registered across all transaction types
     * - Total transactions processed by all observers combined
     * - Total errors and dropped transactions system-wide
     * - Total queue depth (sum of all observer queues)
     * - Average processing time across all observers with non-zero processing
     * - Highest error rate among all observers (for alerting)
     * - Count of observers that have encountered errors
     *
     * Why these metrics matter:
     * - High total queue depth indicates observers falling behind blockchain sync
     * - Increasing error counts suggest plugin bugs or resource exhaustion
     * - High error rates on specific observers warrant investigation
     * - Average processing time trending up may indicate performance degradation
     *
     * @returns Aggregated statistics object with system-wide totals and averages
     */
    public getAggregateStats(): {
        totalObservers: number;
        totalProcessed: number;
        totalErrors: number;
        totalDropped: number;
        totalQueueDepth: number;
        avgProcessingTimeMs: number;
        highestErrorRate: number;
        observersWithErrors: number;
    } {
        const observerStats = this.getAllObserverStats();

        const totalObservers = observerStats.length;
        const totalProcessed = observerStats.reduce((sum, s) => sum + s.totalProcessed, 0);
        const totalErrors = observerStats.reduce((sum, s) => sum + s.totalErrors, 0);
        const totalDropped = observerStats.reduce((sum, s) => sum + s.totalDropped, 0);
        const totalQueueDepth = observerStats.reduce((sum, s) => sum + s.queueDepth, 0);

        const observersWithProcessing = observerStats.filter(s => s.totalProcessed > 0);
        const avgProcessingTimeMs = observersWithProcessing.length > 0
            ? Number((observersWithProcessing.reduce((sum, s) => sum + s.avgProcessingTimeMs, 0) / observersWithProcessing.length).toFixed(2))
            : 0;

        const highestErrorRate = observerStats.length > 0
            ? Math.max(...observerStats.map(s => s.errorRate))
            : 0;

        const observersWithErrors = observerStats.filter(s => s.totalErrors > 0).length;

        return {
            totalObservers,
            totalProcessed,
            totalErrors,
            totalDropped,
            totalQueueDepth,
            avgProcessingTimeMs,
            highestErrorRate,
            observersWithErrors
        };
    }

    /**
     * Get service health status.
     *
     * Provides a quick health check for monitoring and alerting. Returns the total number
     * of registered observers and subscription counts. A healthy service should have at least
     * one observer registered if plugins with blockchain features are active.
     *
     * @returns Object containing total observer count and subscription statistics
     */
    public getHealthStatus(): { totalObservers: number; subscriptions: Record<string, number> } {
        return {
            totalObservers: this.getAllObserverStats().length,
            subscriptions: this.getSubscriptionStats()
        };
    }

    // =========================================================================
    // Batch Subscription Methods
    // =========================================================================

    /**
     * Subscribe a batch observer to a specific transaction type.
     *
     * Registers the observer to receive batched notifications containing all transactions
     * of the specified type from each block. Instead of receiving individual transactions,
     * the observer receives a single call with an array of all matching transactions after
     * the block completes processing.
     *
     * @param transactionType - The transaction type to observe (e.g., 'TransferContract')
     * @param observer - The batch observer instance to notify with transaction arrays
     */
    public subscribeTransactionTypeBatch(transactionType: string, observer: IBaseBatchObserver): void {
        const subscribers = this.batchTypeSubscribers.get(transactionType as TransactionType) ?? new Set();
        subscribers.add(observer);
        this.batchTypeSubscribers.set(transactionType as TransactionType, subscribers);

        this.logger.info(
            {
                transactionType,
                observerName: observer.getName(),
                totalBatchSubscribers: subscribers.size
            },
            'Batch observer subscribed to transaction type'
        );
    }

    /**
     * Accumulate a transaction for batch notification.
     *
     * Called during block processing to collect transactions by type. After all transactions
     * in a block are processed, flushBatches() delivers accumulated transactions to batch
     * subscribers. This method is synchronous and fast - it only stores a reference.
     *
     * @param transaction - The enriched transaction to accumulate
     */
    public accumulateForBatch(transaction: ITransaction): void {
        const txType = transaction.payload.type;
        const batch = this.batchAccumulator.get(txType) ?? [];
        batch.push(transaction);
        this.batchAccumulator.set(txType, batch);
    }

    /**
     * Clear the batch accumulator.
     *
     * Called at the start of each block to reset the accumulator before processing
     * transactions. Ensures batch observers receive transactions from only one block.
     */
    public clearBatchAccumulator(): void {
        this.batchAccumulator.clear();
    }

    /**
     * Flush accumulated batches to batch subscribers.
     *
     * Called after all transactions in a block have been processed and accumulated.
     * Delivers each transaction type's batch to subscribed batch observers using
     * fire-and-forget semantics.
     */
    public async flushBatches(): Promise<void> {
        for (const [txType, transactions] of this.batchAccumulator.entries()) {
            if (transactions.length === 0) {
                continue;
            }

            const subscribers = this.batchTypeSubscribers.get(txType);
            if (!subscribers || subscribers.size === 0) {
                continue;
            }

            // Fire and forget - don't wait for batch observers to complete
            const notifications = Array.from(subscribers).map(async observer => {
                try {
                    await observer.enqueueBatch(transactions);
                } catch (error) {
                    this.logger.error(
                        {
                            observer: observer.getName(),
                            transactionType: txType,
                            batchSize: transactions.length,
                            error
                        },
                        'Failed to enqueue batch to observer'
                    );
                }
            });

            void Promise.all(notifications);
        }

        // Clear accumulator after flush
        this.batchAccumulator.clear();
    }

    /**
     * Get batch subscription statistics.
     *
     * Returns subscriber counts by transaction type for batch observers.
     */
    public getBatchSubscriptionStats(): Record<string, number> {
        const stats: Record<string, number> = {};

        for (const [type, subscribers] of this.batchTypeSubscribers.entries()) {
            stats[type] = subscribers.size;
        }

        return stats;
    }

    // =========================================================================
    // Block Subscription Methods
    // =========================================================================

    /**
     * Subscribe a block observer to receive entire blocks.
     *
     * Registers the observer to receive complete block data including all enriched
     * transactions after each block finishes processing. Enables cross-transaction
     * analysis and block-level metrics calculation.
     *
     * @param observer - The block observer instance to notify with block data
     */
    public subscribeBlock(observer: IBaseBlockObserver): void {
        this.blockSubscribers.add(observer);

        this.logger.info(
            {
                observerName: observer.getName(),
                totalBlockSubscribers: this.blockSubscribers.size
            },
            'Block observer subscribed'
        );
    }

    /**
     * Notify all block subscribers of a completed block.
     *
     * Called after block processing completes with the full block data and all
     * enriched transactions. Uses fire-and-forget semantics to avoid blocking
     * the blockchain sync pipeline.
     *
     * @param blockData - Block metadata and all enriched transactions
     */
    public async notifyBlock(blockData: IBlockData): Promise<void> {
        if (this.blockSubscribers.size === 0) {
            return;
        }

        // Fire and forget - don't wait for block observers to complete
        const notifications = Array.from(this.blockSubscribers).map(async observer => {
            try {
                await observer.enqueueBlock(blockData);
            } catch (error) {
                this.logger.error(
                    {
                        observer: observer.getName(),
                        blockNumber: blockData.blockNumber,
                        transactionCount: blockData.transactionCount,
                        error
                    },
                    'Failed to enqueue block to observer'
                );
            }
        });

        void Promise.all(notifications);
    }

    /**
     * Get block subscription statistics.
     *
     * Returns the count of block observers subscribed.
     */
    public getBlockSubscriptionStats(): { subscriberCount: number } {
        return {
            subscriberCount: this.blockSubscribers.size
        };
    }

    // =========================================================================
    // Enhanced Statistics (includes batch and block observers)
    // =========================================================================

    /**
     * Get detailed performance statistics for all observers (including batch and block).
     *
     * Overrides the base method to include batch and block observers in the statistics.
     */
    public getAllObserverStats(): IObserverStats[] {
        const allObservers = new Set<IBaseObserver>();

        // Collect individual transaction observers
        for (const subscribers of this.transactionTypeSubscribers.values()) {
            for (const observer of subscribers) {
                allObservers.add(observer);
            }
        }

        // Collect batch observers
        for (const subscribers of this.batchTypeSubscribers.values()) {
            for (const observer of subscribers) {
                allObservers.add(observer);
            }
        }

        // Collect block observers
        for (const observer of this.blockSubscribers) {
            allObservers.add(observer);
        }

        return Array.from(allObservers).map(observer => observer.getStats());
    }

    /**
     * Reset service state (for testing only).
     *
     * Clears all observer subscriptions and resets the singleton instance. This should only
     * be called in test environments to ensure clean state between test runs. Never call this
     * in production code.
     *
     * @internal
     */
    public static resetForTesting(): void {
        if (BlockchainObserverService.instance) {
            BlockchainObserverService.instance.transactionTypeSubscribers.clear();
            BlockchainObserverService.instance.batchTypeSubscribers.clear();
            BlockchainObserverService.instance.blockSubscribers.clear();
            BlockchainObserverService.instance.batchAccumulator.clear();
            BlockchainObserverService.instance = null;
        }
    }
}
