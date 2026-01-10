import type { IBaseObserver, IBlockchainObserverService, IPluginWebSocketManager, ISystemLogService, IPluginDatabase } from '@/types';
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
export declare function createWhaleDetectionObserver(BaseObserver: abstract new (logger: ISystemLogService) => IBaseObserver, observerRegistry: IBlockchainObserverService, websocket: IPluginWebSocketManager, database: IPluginDatabase, logger: ISystemLogService): IBaseObserver;
//# sourceMappingURL=whale-detection.observer.d.ts.map