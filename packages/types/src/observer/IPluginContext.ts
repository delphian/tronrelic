import type { IBlockchainObserverService } from './IBlockchainObserverService.js';
import type { IWebSocketService } from './IWebSocketService.js';
import type { IBaseObserver } from './IBaseObserver.js';
import type { IDatabaseService } from '../database/IDatabaseService.js';
import type { IPluginWebSocketManager } from './IPluginWebSocketManager.js';
import type { ICacheService } from '../services/ICacheService.js';
import type { ISystemConfigService } from '../system-config/ISystemConfigService.js';
import { ISystemLogService } from '../system-log/ISystemLogService.js';

/**
 * Plugin context provided to backend plugins during initialization.
 *
 * Contains infrastructure services that plugins receive via dependency injection.
 * This context allows plugins to interact with core backend services without
 * importing concrete implementations, preventing circular dependencies.
 * The injected logger keeps structured telemetry consistent across plugins.
 */
export interface IPluginContext {
    /** Blockchain observer service for subscribing to blockchain transaction types */
    observerRegistry: IBlockchainObserverService;

    /** WebSocket service for emitting real-time events to frontend clients (legacy, prefer websocket) */
    websocketService: IWebSocketService;

    /** Plugin-scoped WebSocket manager for custom subscriptions, rooms, and namespaced events */
    websocket: IPluginWebSocketManager;

    /**
     * Base observer class constructor for plugins to extend.
     *
     * Receives a scoped logger so each observer instance emits structured logs
     * with plugin metadata baked in.
     */
    BaseObserver: abstract new (logger: ISystemLogService) => IBaseObserver;

    /** Plugin-scoped database access with automatic collection prefixing */
    database: IDatabaseService;

    /** Cache service for Redis-backed key-value storage with TTL and tagging */
    cache: ICacheService;

    /** System configuration service for accessing runtime-editable settings like site URL */
    systemConfig: ISystemConfigService;

    /** Structured logger scoped to the plugin for consistent telemetry */
    logger: ISystemLogService;
}
