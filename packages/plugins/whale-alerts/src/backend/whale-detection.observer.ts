import type { ITransaction, IBaseObserver, IBlockchainObserverService, IPluginWebSocketManager, ILogger, IPluginDatabase } from '@tronrelic/types';
import type { IWhaleTransaction, IWhaleAlertsConfig } from '../shared/types/index.js';

/**
 * Whale Detection Observer centralizes whale transfer detection, persistence, and notifications.
 *
 * This observer listens for large TRX transfers, persists them to the plugin database,
 * emits real-time websocket events to appropriate rooms, and handles Telegram notifications.
 * It owns all whale-related functionality, keeping the core blockchain service agnostic.
 */

/**
 * Create the whale detection observer with injected infrastructure services.
 *
 * The factory receives the base observer implementation, registry, websocket manager,
 * database service, and logger through dependency injection. This keeps the plugin
 * portable while integrating with the blockchain transaction pipeline.
 *
 * @param BaseObserver - Base observer class providing queue management and error isolation
 * @param observerRegistry - Registry for subscribing to specific transaction types
 * @param websocket - Plugin-scoped WebSocket manager for room-based event emission
 * @param database - Plugin-scoped database service for whale transaction persistence
 * @param logger - Structured logger scoped to the plugin
 * @returns Instantiated whale detection observer ready to process transactions
 */
export function createWhaleDetectionObserver(
    BaseObserver: abstract new (logger: ILogger) => IBaseObserver,
    observerRegistry: IBlockchainObserverService,
    websocket: IPluginWebSocketManager,
    database: IPluginDatabase,
    logger: ILogger
): IBaseObserver {
    const scopedLogger = logger.child({ observer: 'WhaleDetectionObserver' });

    /**
     * Internal observer that handles whale transfers.
     *
     * The observer subscribes to transfer contract types, evaluates thresholds,
     * persists qualifying transactions, emits socket events to subscribed rooms,
     * and sends Telegram notifications.
     */
    class WhaleDetectionObserver extends BaseObserver {
        protected readonly name = 'WhaleDetectionObserver';
        private readonly websocket: IPluginWebSocketManager;
        private readonly database: IPluginDatabase;

        constructor() {
            super(scopedLogger);
            this.websocket = websocket;
            this.database = database;

            // Subscribe only to transfer transactions
            observerRegistry.subscribeTransactionType('TransferContract', this);
        }

        /**
         * Process incoming transactions and handle whale-sized transfers.
         *
         * For each transaction that exceeds the whale threshold:
         * 1. Persist to plugin database
         * 2. Emit websocket event to all subscribed threshold rooms
         * 3. Send Telegram notification (if enabled via persistence)
         *
         * @param transaction - Enriched transaction from the blockchain service
         */
        protected async process(transaction: ITransaction): Promise<void> {
            if (!transaction?.payload) {
                scopedLogger.debug('Skipping transaction without payload');
                return;
            }

            const amount = Number(transaction.payload.amountTRX ?? 0);
            const type = transaction.payload.type;

            // Only process transfer contracts
            if (type !== 'TransferContract') {
                scopedLogger.debug({ type }, 'Skipping non-transfer transaction');
                return;
            }

            // Load configuration from database
            const config = await this.database.get<IWhaleAlertsConfig>('config');
            const thresholdTRX = config?.thresholdTRX ?? 1_000_000; // Default threshold

            // Check if transaction exceeds whale threshold
            if (amount < thresholdTRX) {
                return;
            }

            scopedLogger.debug({ txId: transaction.payload.txId, amountTRX: amount }, 'Processing whale transaction');

            // Persist whale transaction to database
            await this.persistWhaleTransaction(transaction, thresholdTRX, config);

            scopedLogger.debug(
                { txId: transaction.payload.txId, amountTRX: amount },
                'Emitting whale transaction to large-transfer room'
            );

            // Emit to the single large-transfer room
            // All whale transactions above the threshold go to this room
            this.websocket.emitToRoom('large-transfer', 'large-transfer', transaction.snapshot);

            scopedLogger.debug(
                { txId: transaction.payload.txId, amountTRX: amount },
                'Emitted to large-transfer room'
            );
        }

        /**
         * Persist whale transaction to the plugin database.
         *
         * Stores transaction details for historical analysis and dashboard display.
         * Uses upsert logic to avoid duplicates.
         *
         * @param transaction - Transaction to persist
         * @param thresholdTRX - Threshold that triggered this whale alert
         * @param config - Plugin configuration
         */
        private async persistWhaleTransaction(
            transaction: ITransaction,
            thresholdTRX: number,
            config: IWhaleAlertsConfig | undefined
        ): Promise<void> {
            const txId = transaction.payload.txId;
            if (!txId) {
                return;
            }

            // Check if already persisted
            const existing = await this.database.findOne('transactions', { txId });
            if (existing) {
                return;
            }

            const whaleTransaction: Omit<IWhaleTransaction, 'createdAt' | 'updatedAt'> = {
                txId,
                timestamp: transaction.payload.timestamp || new Date(),
                amountSun: Number(transaction.payload.amount ?? 0),
                amountTRX: Number(transaction.payload.amountTRX ?? 0),
                amountUSD: transaction.payload.amountUSD,
                fromAddress: transaction.payload.from?.address || '',
                toAddress: transaction.payload.to?.address || '',
                pattern: transaction.payload.analysis?.pattern,
                clusterId: transaction.payload.analysis?.clusterId,
                confidence: transaction.payload.analysis?.confidence,
                channelId: config?.telegramChannelId,
                threadId: config?.telegramThreadId,
                thresholdTRX,
                notifiedAt: null,
            };

            await this.database.insertOne('transactions', whaleTransaction);

            scopedLogger.debug(
                { txId, amountTRX: whaleTransaction.amountTRX },
                'Persisted whale transaction'
            );
        }
    }

    return new WhaleDetectionObserver();
}
