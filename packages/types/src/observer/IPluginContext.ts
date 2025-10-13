import type { IObserverRegistry } from './IObserverRegistry.js';
import type { IWebSocketService } from './IWebSocketService.js';
import type { IBaseObserver } from './IBaseObserver.js';
import type { IPluginDatabase } from '../plugin/IPluginDatabase.js';
import type { ILogger } from '../logging/ILogger.js';
import type { IPluginWebSocketManager } from './IPluginWebSocketManager.js';

/**
 * Plugin context provided to backend plugins during initialization.
 *
 * Contains infrastructure services that plugins receive via dependency injection.
 * This context allows plugins to interact with core backend services without
 * importing concrete implementations, preventing circular dependencies.
 * The injected logger keeps structured telemetry consistent across plugins.
 */
export interface IPluginContext {
    /** Observer registry for subscribing to blockchain transaction types */
    observerRegistry: IObserverRegistry;

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
    BaseObserver: abstract new (logger: ILogger) => IBaseObserver;

    /** Plugin-scoped database access with automatic collection prefixing */
    database: IPluginDatabase;

    /** Structured logger scoped to the plugin for consistent telemetry */
    logger: ILogger;
}
