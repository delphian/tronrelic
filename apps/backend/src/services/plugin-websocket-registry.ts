import type {
    IPluginWebSocketStats,
    IAggregatePluginWebSocketStats
} from '@tronrelic/types';
import type { PluginWebSocketManager } from './plugin-websocket-manager.js';
import { logger } from '../lib/logger.js';

/**
 * Registry for tracking all plugin WebSocket managers and their statistics.
 *
 * Maintains a central registry of plugin WebSocket managers for monitoring, debugging,
 * and admin interface integration. Provides aggregate statistics across all plugins and
 * per-plugin detailed metrics. This singleton ensures consistent tracking of WebSocket
 * activity across the entire plugin ecosystem.
 */
export class PluginWebSocketRegistry {
    private static instance: PluginWebSocketRegistry;
    private readonly managers = new Map<string, { manager: PluginWebSocketManager; title: string }>();

    private constructor() {}

    /**
     * Get the singleton instance of the plugin WebSocket registry.
     *
     * Creates the instance on first call and returns the same instance for all subsequent
     * calls. Ensures all plugin managers are tracked in one central location.
     *
     * @returns The singleton PluginWebSocketRegistry instance
     */
    public static getInstance(): PluginWebSocketRegistry {
        if (!PluginWebSocketRegistry.instance) {
            PluginWebSocketRegistry.instance = new PluginWebSocketRegistry();
        }
        return PluginWebSocketRegistry.instance;
    }

    /**
     * Register a plugin WebSocket manager.
     *
     * Adds a plugin's WebSocket manager to the registry for tracking and statistics.
     * Called by the plugin loader during plugin initialization. Overwrites any existing
     * manager for the same plugin ID.
     *
     * @param pluginId - The unique plugin identifier
     * @param pluginTitle - The human-readable plugin title from the manifest
     * @param manager - The plugin's WebSocket manager instance
     */
    public register(pluginId: string, pluginTitle: string, manager: PluginWebSocketManager): void {
        this.managers.set(pluginId, { manager, title: pluginTitle });
        logger.debug(
            { pluginId, pluginTitle },
            'Plugin WebSocket manager registered'
        );
    }

    /**
     * Unregister a plugin WebSocket manager.
     *
     * Removes a plugin's WebSocket manager from the registry. Called when a plugin
     * is disabled or uninstalled. Safe to call even if the plugin is not registered.
     *
     * @param pluginId - The unique plugin identifier to unregister
     */
    public unregister(pluginId: string): void {
        const entry = this.managers.get(pluginId);
        if (entry) {
            this.managers.delete(pluginId);
            logger.debug(
                { pluginId, pluginTitle: entry.title },
                'Plugin WebSocket manager unregistered'
            );
        }
    }

    /**
     * Get a plugin's WebSocket manager by ID.
     *
     * Retrieves the manager instance for a specific plugin. Used by WebSocketService
     * to route subscription and unsubscribe events to the appropriate plugin handler.
     *
     * @param pluginId - The unique plugin identifier
     * @returns The plugin's WebSocket manager or undefined if not registered
     */
    public getManager(pluginId: string): PluginWebSocketManager | undefined {
        return this.managers.get(pluginId)?.manager;
    }

    /**
     * Get all registered plugin IDs.
     *
     * Returns an array of plugin IDs that have registered WebSocket managers. Useful
     * for iterating over all plugins or checking if any plugins are using WebSockets.
     *
     * @returns Array of registered plugin IDs
     */
    public getAllPluginIds(): string[] {
        return Array.from(this.managers.keys());
    }

    /**
     * Get detailed statistics for a specific plugin.
     *
     * Retrieves comprehensive WebSocket metrics for a single plugin including room
     * membership, event counts, error rates, and handler registration status. Returns
     * undefined if the plugin is not registered.
     *
     * @param pluginId - The unique plugin identifier
     * @returns Promise resolving to plugin statistics or undefined if not found
     */
    public async getPluginStats(pluginId: string): Promise<IPluginWebSocketStats | undefined> {
        const entry = this.managers.get(pluginId);
        if (!entry) {
            return undefined;
        }

        const stats = await entry.manager.getStats();

        return {
            pluginId,
            pluginTitle: entry.title,
            hasSubscriptionHandler: stats.hasSubscriptionHandler,
            hasUnsubscribeHandler: stats.hasUnsubscribeHandler,
            activeRooms: stats.rooms.length,
            totalSubscriptions: stats.rooms.reduce((sum, room) => sum + room.memberCount, 0),
            roomStats: stats.rooms,
            totalEventsEmitted: stats.totalEventsEmitted,
            totalSubscriptionErrors: stats.totalSubscriptionErrors,
            lastEventEmittedAt: stats.lastEventEmittedAt,
            lastSubscriptionErrorAt: stats.lastSubscriptionErrorAt,
            eventsPerMinute: stats.eventsPerMinute
        };
    }

    /**
     * Get detailed statistics for all registered plugins.
     *
     * Retrieves comprehensive WebSocket metrics for every plugin in the registry.
     * Used by the admin API to display per-plugin monitoring data in the UI.
     *
     * @returns Promise resolving to an array of plugin statistics
     */
    public async getAllPluginStats(): Promise<IPluginWebSocketStats[]> {
        const statsPromises = Array.from(this.managers.keys()).map(pluginId =>
            this.getPluginStats(pluginId)
        );

        const allStats = await Promise.all(statsPromises);
        return allStats.filter((stats): stats is IPluginWebSocketStats => stats !== undefined);
    }

    /**
     * Get aggregate statistics across all plugins.
     *
     * Computes system-wide WebSocket metrics by aggregating data from all registered
     * plugins. Includes totals, averages, and identification of the most active plugins
     * by subscription count and event emission rate. Used by the admin API for dashboard
     * overview widgets.
     *
     * @returns Promise resolving to aggregate statistics
     */
    public async getAggregateStats(): Promise<IAggregatePluginWebSocketStats> {
        const allStats = await this.getAllPluginStats();

        const totalPlugins = allStats.length;
        const pluginsWithActiveSubscriptions = allStats.filter(s => s.totalSubscriptions > 0).length;
        const totalRooms = allStats.reduce((sum, s) => sum + s.activeRooms, 0);
        const totalSubscriptions = allStats.reduce((sum, s) => sum + s.totalSubscriptions, 0);
        const totalEventsEmitted = allStats.reduce((sum, s) => sum + s.totalEventsEmitted, 0);
        const totalSubscriptionErrors = allStats.reduce((sum, s) => sum + s.totalSubscriptionErrors, 0);

        // Find plugin with most subscriptions
        const mostActivePlugin = allStats.reduce<{ pluginId: string; subscriptionCount: number } | undefined>(
            (max, stats) => {
                if (!max || stats.totalSubscriptions > max.subscriptionCount) {
                    return {
                        pluginId: stats.pluginId,
                        subscriptionCount: stats.totalSubscriptions
                    };
                }
                return max;
            },
            undefined
        );

        // Find plugin with highest emission rate
        const mostActiveEmitter = allStats.reduce<{ pluginId: string; eventsPerMinute: number } | undefined>(
            (max, stats) => {
                if (!max || stats.eventsPerMinute > max.eventsPerMinute) {
                    return {
                        pluginId: stats.pluginId,
                        eventsPerMinute: stats.eventsPerMinute
                    };
                }
                return max;
            },
            undefined
        );

        return {
            totalPlugins,
            pluginsWithActiveSubscriptions,
            totalRooms,
            totalSubscriptions,
            totalEventsEmitted,
            totalSubscriptionErrors,
            mostActivePlugin,
            mostActiveEmitter
        };
    }

    /**
     * Clear all registered plugin managers.
     *
     * Removes all plugins from the registry. Used for testing or during application
     * shutdown. This does not affect the actual plugin managers, only the registry's
     * tracking of them.
     *
     * @internal
     */
    public clear(): void {
        this.managers.clear();
        logger.debug('Plugin WebSocket registry cleared');
    }
}
