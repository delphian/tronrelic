import type {
    ITransaction,
    IBaseObserver,
    IBlockchainObserverService,
    IPluginDatabase,
    ISystemLogService
} from '@tronrelic/types';
import type { IDelegationTransaction, IWhaleDelegation, IResourceTrackingConfig } from '../shared/types/index.js';

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
    BaseObserver: abstract new (logger: ISystemLogService) => IBaseObserver,
    observerRegistry: IBlockchainObserverService,
    database: IPluginDatabase,
    logger: ISystemLogService
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

            // Extract delegation details from transaction payload
            const isDelegation = type === 'DelegateResourceContract';
            const amountSun = Number(payload.amount ?? 0);

            // Determine resource type from contract parameters
            // The contract.parameters.resource field is set during blockchain service parsing
            const contractParams = payload.contract?.parameters as Record<string, unknown> | undefined;
            const resourceValue = contractParams?.resource;

            // TRON resource types: 'BANDWIDTH' = 0, 'ENERGY' = 1
            // TRON protocol: missing/null resource field defaults to BANDWIDTH
            const resourceType: 0 | 1 =
                (typeof resourceValue === 'string' && resourceValue.toUpperCase() === 'ENERGY') ||
                (typeof resourceValue === 'number' && resourceValue === 1)
                ? 1 : 0;

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

            try {
                await this.database.insertOne('transactions', delegationRecord);
                // Transaction persisted successfully (debug logging removed for performance)
            } catch (error) {
                // Duplicate key error (E11000) - transaction already exists due to unique index on txId
                // This can happen if blocks are reprocessed or observers restart mid-block

                // MongoDB errors can have different structures depending on the driver version
                // Check both top-level and nested error.code properties
                const isDuplicateError = error && typeof error === 'object' && (
                    ('code' in error && error.code === 11000) ||
                    ('error' in error && typeof error.error === 'object' && error.error && 'code' in error.error && error.error.code === 11000)
                );

                if (isDuplicateError) {
                    scopedLogger.warn({
                        txId,
                        blockNumber: payload.blockNumber
                    }, 'Delegation transaction already persisted - skipping duplicate');
                    return;
                }

                // Re-throw non-duplicate errors for observer error handling
                throw error;
            }

            // Whale detection: Check if delegation exceeds threshold
            await this.detectWhale(delegationRecord, scopedLogger);
        }

        /**
         * Detect and persist whale delegations that exceed configured threshold.
         *
         * Checks if the delegation amount exceeds the whale threshold and, if enabled,
         * stores the delegation in a separate whale-delegations collection for
         * specialized tracking and analysis.
         *
         * @param delegation - The delegation record that was just persisted
         * @param logger - Scoped logger for whale detection events
         */
        private async detectWhale(
            delegation: Omit<IDelegationTransaction, 'createdAt'>,
            logger: ISystemLogService
        ): Promise<void> {
            try {
                // Load configuration to check if whale detection is enabled
                const config = await this.database.get<IResourceTrackingConfig>('config');
                if (!config || !config.whaleDetectionEnabled) {
                    return; // Whale detection disabled
                }

                // Convert threshold from TRX to SUN for comparison (1 TRX = 1,000,000 SUN)
                const thresholdSun = config.whaleThresholdTrx * 1_000_000;

                // Use absolute value since reclaims are stored as negative amounts
                const amountSun = Math.abs(delegation.amountSun);

                // Check if delegation exceeds threshold
                if (amountSun < thresholdSun) {
                    return; // Below threshold, not a whale
                }

                // Create whale delegation record
                const whaleDelegation: Omit<IWhaleDelegation, 'createdAt'> = {
                    txId: delegation.txId,
                    timestamp: delegation.timestamp,
                    fromAddress: delegation.fromAddress,
                    toAddress: delegation.toAddress,
                    resourceType: delegation.resourceType,
                    amountSun: amountSun, // Store positive amount for whale records
                    amountTrx: amountSun / 1_000_000, // Convert to TRX for display
                    blockNumber: delegation.blockNumber
                };

                // Persist whale delegation to separate collection
                await this.database.insertOne('whale-delegations', whaleDelegation);

                logger.info({
                    txId: delegation.txId,
                    fromAddress: delegation.fromAddress,
                    toAddress: delegation.toAddress,
                    amountTrx: whaleDelegation.amountTrx,
                    resourceType: delegation.resourceType === 1 ? 'ENERGY' : 'BANDWIDTH',
                    threshold: config.whaleThresholdTrx
                }, 'Whale delegation detected and persisted');
            } catch (error) {
                // Check for duplicate key error (whale already recorded)
                const isDuplicateError = error && typeof error === 'object' && (
                    ('code' in error && error.code === 11000) ||
                    ('error' in error && typeof error.error === 'object' && error.error && 'code' in error.error && error.error.code === 11000)
                );

                if (isDuplicateError) {
                    logger.debug({ txId: delegation.txId }, 'Whale delegation already persisted');
                    return;
                }

                // Log error but don't throw - whale detection failure shouldn't break transaction processing
                logger.error({ error, txId: delegation.txId }, 'Failed to persist whale delegation');
            }
        }
    }

    return new DelegationTrackerObserver();
}
