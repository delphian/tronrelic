import type {
    ITransaction,
    IBaseObserver,
    IObserverRegistry,
    IPluginDatabase,
    ILogger
} from '@tronrelic/types';
import type { IDelegationTransaction } from '../shared/types/index.js';

/**
 * Delegation Tracker Observer processes resource delegation and reclaim transactions.
 *
 * This observer subscribes to DelegateResourceContract and UnDelegateResourceContract types,
 * extracts detailed delegation information from the transaction payload, and persists
 * transaction records for aggregation and analysis. The observer tracks both energy
 * and bandwidth delegation flows across the TRON network.
 *
 * Data retention is managed by a separate purge job that runs hourly.
 */

/**
 * Create the delegation tracker observer with injected infrastructure services.
 *
 * The factory receives the base observer implementation, registry, database service,
 * and logger through dependency injection, keeping the plugin portable while integrating
 * with the blockchain transaction pipeline.
 *
 * @param BaseObserver - Base observer class providing queue management and error isolation, needed to extend functionality for delegation tracking
 * @param observerRegistry - Registry for subscribing to specific transaction types, allows this observer to receive delegation events
 * @param database - Plugin-scoped database service for delegation transaction persistence with automatic collection prefixing
 * @param logger - Structured logger scoped to the plugin so delegation logs stay contextualized
 * @returns Instantiated delegation tracker observer ready to process transactions
 */
export function createDelegationTrackerObserver(
    BaseObserver: abstract new (logger: ILogger) => IBaseObserver,
    observerRegistry: IObserverRegistry,
    database: IPluginDatabase,
    logger: ILogger
): IBaseObserver {
    const scopedLogger = logger.child({ observer: 'DelegationTrackerObserver' });

    /**
     * Internal observer that tracks resource delegation and reclaim operations.
     *
     * Subscribes to delegation contract types, extracts delegation details from
     * transaction payloads, and persists records with TTL for eventual aggregation.
     * Uses positive amounts for delegations and negative amounts for reclaims to
     * simplify summation calculations.
     */
    class DelegationTrackerObserver extends BaseObserver {
        protected readonly name = 'DelegationTrackerObserver';
        private readonly database: IPluginDatabase;

        constructor() {
            super(scopedLogger);
            this.database = database;

            // Subscribe to both delegation and reclaim transaction types
            observerRegistry.subscribeTransactionType('DelegateResourceContract', this);
            observerRegistry.subscribeTransactionType('UnDelegateResourceContract', this);
        }

        /**
         * Process incoming delegation/reclaim transactions and persist to database.
         *
         * For each delegation transaction:
         * 1. Extract delegation details from transaction payload
         * 2. Determine resource type (ENERGY=1 or BANDWIDTH=0)
         * 3. Set amount sign (positive for delegate, negative for reclaim)
         * 4. Store with TTL for later aggregation by summation job
         *
         * @param transaction - Enriched transaction from the blockchain service
         */
        protected async process(transaction: ITransaction): Promise<void> {
            if (!transaction?.payload) {
                scopedLogger.debug('Skipping transaction without payload');
                return;
            }

            const { payload } = transaction;
            const type = payload.type;

            // Only process delegation contract types
            if (type !== 'DelegateResourceContract' && type !== 'UnDelegateResourceContract') {
                scopedLogger.debug({ type }, 'Skipping non-delegation transaction');
                return;
            }

            const txId = payload.txId;
            if (!txId) {
                scopedLogger.error('Skipping transaction without txId');
                return;
            }

            // Check if already persisted to avoid duplicates
            const existing = await this.database.findOne<IDelegationTransaction>('transactions', { txId });
            if (existing) {
                scopedLogger.info({ txId }, 'Delegation transaction already persisted - skipping');
                return;
            }

            // Extract delegation details from transaction payload
            const isDelegation = type === 'DelegateResourceContract';
            const amountSun = Number(payload.amount ?? 0);

            // Determine resource type from contract parameters
            // The contract.parameters.resource field is set during blockchain service parsing
            const contractParams = payload.contract?.parameters as Record<string, unknown> | undefined;
            const resourceValue = contractParams?.resource;

            // TRON resource types: 'BANDWIDTH' = 0, 'ENERGY' = 1
            // Parse from string or numeric value
            let resourceType: 0 | 1 = 1; // Default to ENERGY
            if (typeof resourceValue === 'string') {
                resourceType = resourceValue.toUpperCase() === 'BANDWIDTH' ? 0 : 1;
            } else if (typeof resourceValue === 'number') {
                resourceType = resourceValue === 0 ? 0 : 1;
            }

            // Use negative amount for reclaims to simplify aggregation
            const signedAmount = isDelegation ? amountSun : -amountSun;

            // Extract lock information (if available in contract parameters)
            const locked = Boolean(contractParams?.lock);
            const lockPeriod = typeof contractParams?.lock_period === 'number'
                ? contractParams.lock_period
                : undefined;

            const delegationRecord: Omit<IDelegationTransaction, 'createdAt'> = {
                txId,
                timestamp: payload.timestamp || new Date(),
                fromAddress: payload.from?.address || 'unknown',
                toAddress: payload.to?.address || 'unknown',
                resourceType,
                amountSun: signedAmount,
                locked,
                lockPeriod,
                blockNumber: payload.blockNumber
            };

            await this.database.insertOne('transactions', delegationRecord);

            scopedLogger.debug(
                {
                    txId,
                    type,
                    resourceType: resourceType === 0 ? 'BANDWIDTH' : 'ENERGY',
                    amountSun: signedAmount,
                    blockNumber: payload.blockNumber
                },
                'Persisted delegation transaction'
            );
        }
    }

    return new DelegationTrackerObserver();
}
