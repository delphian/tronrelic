import type {
    ITransaction,
    IBaseObserver,
    IBlockchainObserverService,
    IPluginDatabase,
    ISystemLogService,
    IPluginWebSocketManager,
    IBlockchainService
} from '@tronrelic/types';
import type { IDelegationTransaction, IWhaleDelegation, IResourceTrackingConfig, IPoolDelegation } from '../shared/types/index.js';
import { PoolMembershipService } from './pool-membership.service.js';
import { aggregatePools } from './pools.service.js';

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
 * websocket manager, and logger through dependency injection, keeping the plugin
 * portable while integrating with the blockchain transaction pipeline.
 *
 * @param BaseObserver - Base observer class providing queue management and error isolation, needed to extend functionality for delegation tracking
 * @param observerRegistry - Registry for subscribing to specific transaction types, allows this observer to receive delegation events
 * @param database - Plugin-scoped database service for delegation transaction persistence with automatic collection prefixing
 * @param websocket - WebSocket manager for emitting real-time pool delegation events
 * @param logger - Structured logger scoped to the plugin so delegation logs stay contextualized
 * @param poolMembershipService - Service for discovering pool-to-account relationships
 * @param blockchainService - Blockchain service for accessing sync state
 * @returns Instantiated delegation tracker observer ready to process transactions
 */
export function createDelegationTrackerObserver(
    BaseObserver: abstract new (logger: ISystemLogService) => IBaseObserver,
    observerRegistry: IBlockchainObserverService,
    database: IPluginDatabase,
    websocket: IPluginWebSocketManager,
    logger: ISystemLogService,
    poolMembershipService: PoolMembershipService,
    blockchainService: IBlockchainService
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
        private readonly websocket: IPluginWebSocketManager;
        private readonly poolMembershipService: PoolMembershipService;
        private readonly blockchainService: IBlockchainService;
        private config: IResourceTrackingConfig | null = null;
        private configLastLoaded = 0;
        private readonly CONFIG_CACHE_MS = 5 * 60 * 1000; // 5 minutes

        // Throttle pool updates to once per block (3 seconds)
        // Instead of emitting per-transaction, we aggregate and push once per block
        private lastPoolUpdateBlock = 0;

        // Track pending fire-and-forget aggregations to detect backlog (Issue #81)
        private pendingPoolUpdates = 0;
        private readonly MAX_PENDING_BEFORE_ERROR = 10;

        constructor() {
            super(scopedLogger);
            this.database = database;
            this.websocket = websocket;
            this.poolMembershipService = poolMembershipService;
            this.blockchainService = blockchainService;

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

            // Pool tracking: Check if this is a pool-controlled delegation (Permission_id >= 3)
            const rawValue = transaction.rawValue as Record<string, unknown>;
            const permissionId = typeof rawValue?.Permission_id === 'number' ? rawValue.Permission_id : 0;

            if (permissionId >= 3 && isDelegation) {
                await this.trackPoolDelegation(
                    delegationRecord,
                    permissionId,
                    lockPeriod,
                    scopedLogger
                );
            }
        }

        /**
         * Load configuration from database with 5-minute cache.
         *
         * Reduces database load by caching whale detection settings in memory.
         * Config is refreshed every 5 minutes, meaning admin changes take effect
         * within 5 minutes without requiring observer restart.
         *
         * @returns Current configuration or null if not set
         */
        private async loadConfigIfStale(): Promise<IResourceTrackingConfig | null> {
            const now = Date.now();
            if (!this.config || (now - this.configLastLoaded) > this.CONFIG_CACHE_MS) {
                this.config = await this.database.get<IResourceTrackingConfig>('config') ?? null;
                this.configLastLoaded = now;
            }
            return this.config;
        }

        /**
         * Detect and persist whale delegations that exceed configured threshold.
         *
         * Checks if the delegation amount exceeds the whale threshold and, if enabled,
         * stores the delegation in a separate whale-delegations collection for
         * specialized tracking and analysis.
         *
         * Uses cached configuration (5-minute TTL) to avoid database load on every
         * delegation transaction. Config changes take effect within 5 minutes.
         *
         * @param delegation - The delegation record that was just persisted
         * @param logger - Scoped logger for whale detection events
         */
        private async detectWhale(
            delegation: Omit<IDelegationTransaction, 'createdAt'>,
            logger: ISystemLogService
        ): Promise<void> {
            try {
                // Load configuration with 5-minute cache (reduces DB load by ~99%)
                const config = await this.loadConfigIfStale();
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

        /**
         * Track pool-controlled delegations (Permission_id >= 3).
         *
         * Pool-controlled delegations are distinguished from direct user delegations
         * because they are authorized by custom permissions granted to pool addresses.
         * This method:
         * 1. Discovers the controlling pool (async, may be null initially)
         * 2. Persists to pool-delegations collection
         * 3. Emits WebSocket event for real-time pool tracking charts
         *
         * @param delegation - The delegation record that was just persisted
         * @param permissionId - Permission ID used to authorize this transaction
         * @param lockPeriod - Lock period in blocks (optional)
         * @param logger - Scoped logger for pool tracking events
         */
        private async trackPoolDelegation(
            delegation: Omit<IDelegationTransaction, 'createdAt'>,
            permissionId: number,
            lockPeriod: number | undefined,
            logger: ISystemLogService
        ): Promise<void> {
            try {
                // Discover the controlling pool (may be null if not yet discovered)
                const poolAddress = await this.poolMembershipService.getPoolForAccount(
                    delegation.fromAddress,
                    permissionId
                );

                // Calculate rental duration in minutes (TRON block time is 3 seconds)
                const rentalPeriodMinutes = lockPeriod ? (lockPeriod * 3) / 60 : undefined;

                // Calculate normalized amount (accounting for rental duration)
                // Multi-day rentals provide more value due to daily energy regeneration
                const amountTrx = Math.abs(delegation.amountSun) / 1_000_000;
                const durationDays = rentalPeriodMinutes ? rentalPeriodMinutes / 60 / 24 : 1;
                const normalizedAmountTrx = amountTrx * durationDays;

                // Create pool delegation record
                const poolDelegation: Omit<IPoolDelegation, 'createdAt'> = {
                    txId: delegation.txId,
                    timestamp: delegation.timestamp,
                    blockNumber: delegation.blockNumber,
                    fromAddress: delegation.fromAddress,
                    toAddress: delegation.toAddress,
                    poolAddress,
                    resourceType: delegation.resourceType,
                    amountSun: delegation.amountSun,
                    permissionId,
                    lockPeriod,
                    rentalPeriodMinutes,
                    normalizedAmountTrx
                };

                // Persist to pool-delegations collection
                await this.database.insertOne('pool-delegations', poolDelegation);

                // Throttle WebSocket updates to once per block.
                // Fire-and-forget pattern: don't await aggregation to avoid blocking transaction processing.
                // Issue #81: Awaiting aggregatePools() caused observer queue overflow at chain tip.
                const currentBlock = delegation.blockNumber;
                if (currentBlock && currentBlock > this.lastPoolUpdateBlock) {
                    this.lastPoolUpdateBlock = currentBlock;

                    // Fire and forget - don't block transaction processing
                    void this.emitPoolUpdate(currentBlock);
                }

                logger.debug({
                    txId: delegation.txId,
                    poolAddress,
                    permissionId,
                    amountTrx,
                    rentalPeriodMinutes
                }, 'Pool delegation tracked');
            } catch (error) {
                // Check for duplicate key error
                const isDuplicateError = error && typeof error === 'object' && (
                    ('code' in error && error.code === 11000) ||
                    ('error' in error && typeof error.error === 'object' && error.error && 'code' in error.error && error.error.code === 11000)
                );

                if (isDuplicateError) {
                    logger.debug({ txId: delegation.txId }, 'Pool delegation already persisted');
                    return;
                }

                // Log error but don't throw - pool tracking failure shouldn't break transaction processing
                logger.error({ error, txId: delegation.txId }, 'Failed to track pool delegation');
            }
        }

        /**
         * Emit aggregated pool data via WebSocket (fire-and-forget).
         *
         * Runs asynchronously to avoid blocking transaction processing. Tracks pending
         * operations and logs errors if backlog exceeds threshold, indicating the
         * aggregation queries are taking longer than the block interval.
         *
         * @param blockNumber - Block number that triggered this update
         */
        private async emitPoolUpdate(blockNumber: number): Promise<void> {
            this.pendingPoolUpdates++;

            if (this.pendingPoolUpdates >= this.MAX_PENDING_BEFORE_ERROR) {
                scopedLogger.error({
                    pendingCount: this.pendingPoolUpdates,
                    blockNumber
                }, 'Pool aggregation backlog critical - aggregations falling behind block production');
            }

            try {
                const poolsData = await aggregatePools(this.database, this.blockchainService, 24);
                this.websocket.emitToRoom('pool-updates', 'pools:updated', poolsData);

                scopedLogger.debug({
                    blockNumber,
                    poolCount: poolsData.pools.length
                }, 'Emitted aggregated pool data');
            } catch (error) {
                scopedLogger.error({ error, blockNumber }, 'Failed to aggregate pools for WebSocket push');
            } finally {
                this.pendingPoolUpdates--;
            }
        }
    }

    return new DelegationTrackerObserver();
}
