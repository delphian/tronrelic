/**
 * Blockchain observer pattern type definitions.
 *
 * Exports all interfaces and types related to the observer pattern used for processing
 * blockchain transactions. These types enable plugins to subscribe to transaction events,
 * emit real-time updates, and monitor observer performance.
 */
export type { IBaseObserver } from './IBaseObserver.js';
export type { IBlockchainObserverService } from './IBlockchainObserverService.js';
export type { IWebSocketService } from './IWebSocketService.js';
export type { IPluginContext } from './IPluginContext.js';
export type { IObserverStats } from './IObserverStats.js';
export type { IPluginWebSocketManager, PluginSubscriptionHandler, PluginUnsubscribeHandler } from './IPluginWebSocketManager.js';
export type { IPluginWebSocketStats, IAggregatePluginWebSocketStats } from './IPluginWebSocketStats.js';
