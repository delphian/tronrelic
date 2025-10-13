import type { IObserverRegistry, IBaseObserver, IObserverStats, ILogger, ITransaction } from '@tronrelic/types';

type TransactionType = ITransaction['payload']['type'];

/**
 * Central registry for blockchain transaction observers.
 *
 * Manages observer registration and routes incoming transactions to subscribed observers
 * based on transaction type. Supports multiple observers per transaction type and provides
 * async fire-and-forget notification semantics where observer failures do not block processing.
 */
export class ObserverRegistry implements IObserverRegistry {
    private static instance: ObserverRegistry | null = null;
    private static logger: ILogger | null = null;
    private logger: ILogger;

    private transactionTypeSubscribers = new Map<TransactionType, Set<IBaseObserver>>();

    private constructor(logger: ILogger) {
        this.logger = logger;
        this.logger.info('Observer registry initialized');
    }

    /**
     * Get the singleton registry instance.
     *
     * Creates the registry on first access and returns the same instance for all subsequent calls.
     * This ensures all observers register with the same central registry regardless of where
     * they are instantiated in the application.
     */
    public static getInstance(logger?: ILogger): ObserverRegistry {
        if (!ObserverRegistry.instance) {
            if (!logger && !ObserverRegistry.logger) {
                throw new Error('ObserverRegistry requires a logger for initialization');
            }

            const resolvedLogger = logger ?? ObserverRegistry.logger as ILogger;
            ObserverRegistry.instance = new ObserverRegistry(resolvedLogger);
            ObserverRegistry.logger = resolvedLogger;
        } else if (logger) {
            ObserverRegistry.instance.logger = logger;
            ObserverRegistry.logger = logger;
        }

        return ObserverRegistry.instance;
    }

    /**
     * Configure the logger used by the observer registry.
     *
     * The configuration applies to subsequent `getInstance` calls. If the registry
     * has already been instantiated, its logger is updated immediately.
     *
     * @param logger - Structured logger for registry telemetry
     */
    public static configure(logger: ILogger): void {
        ObserverRegistry.logger = logger;
        if (ObserverRegistry.instance) {
            ObserverRegistry.instance.logger = logger;
        }
    }

    /**
     * Subscribe an observer to a specific transaction type.
     *
     * Registers the observer to receive notifications when transactions of the specified type
     * are processed. Multiple observers can subscribe to the same transaction type, and each
     * will receive all matching transactions independently. Observers are invoked asynchronously
     * and failures do not affect other observers or block blockchain processing.
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
     */
    public getSubscriptionStats(): Record<string, number> {
        const stats: Record<string, number> = {};

        for (const [type, subscribers] of this.transactionTypeSubscribers.entries()) {
            stats[type] = subscribers.size;
        }

        return stats;
    }

    /**
     * Get detailed performance statistics for all observers.
     *
     * Aggregates real-time metrics from all registered observers including queue depth,
     * processing times, error rates, and throughput. This provides comprehensive monitoring
     * data for performance analysis, alerting, and debugging observer behavior.
     *
     * @returns Array of statistics objects, one per observer instance
     */
    public getAllObserverStats(): IObserverStats[] {
        const allObservers = new Set<IBaseObserver>();

        // Collect all unique observer instances across all subscription types
        for (const subscribers of this.transactionTypeSubscribers.values()) {
            for (const observer of subscribers) {
                allObservers.add(observer);
            }
        }

        // Get stats from each observer
        return Array.from(allObservers).map(observer => observer.getStats());
    }

    /**
     * Get aggregated statistics across all observers.
     *
     * Provides system-wide metrics by combining data from all observers. Useful for
     * high-level monitoring dashboards and capacity planning.
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
}
