/**
 * Statistics for a single plugin's WebSocket activity.
 *
 * Tracks subscription counts, room membership, event emission rates, and errors
 * for monitoring plugin WebSocket health and usage patterns. Exposed through the
 * admin API for debugging and capacity planning.
 */
export interface IPluginWebSocketStats {
    /** The plugin ID these stats belong to */
    pluginId: string;

    /** The human-readable plugin title from the manifest */
    pluginTitle: string;

    /** Whether the plugin has registered a subscription handler */
    hasSubscriptionHandler: boolean;

    /** Whether the plugin has registered an unsubscribe handler */
    hasUnsubscribeHandler: boolean;

    /** Total number of active rooms created by this plugin */
    activeRooms: number;

    /** Total number of clients across all plugin rooms (may include duplicates if clients are in multiple rooms) */
    totalSubscriptions: number;

    /** Breakdown of subscriptions per room */
    roomStats: Array<{
        /** The plugin-local room name (without prefix) */
        roomName: string;

        /** The full namespaced room name as stored in Socket.IO */
        fullRoomName: string;

        /** Number of sockets currently in this room */
        memberCount: number;
    }>;

    /** Total number of events emitted by this plugin since startup */
    totalEventsEmitted: number;

    /** Total number of subscription errors since startup */
    totalSubscriptionErrors: number;

    /** Timestamp of the last event emission */
    lastEventEmittedAt?: string;

    /** Timestamp of the last subscription error */
    lastSubscriptionErrorAt?: string;

    /** Events emitted per minute (recent average) */
    eventsPerMinute: number;
}

/**
 * Aggregate statistics across all plugin WebSocket activity.
 *
 * Provides a system-wide view of WebSocket usage for monitoring overall health,
 * identifying high-traffic plugins, and detecting anomalies. Exposed through the
 * admin API for operational dashboards.
 */
export interface IAggregatePluginWebSocketStats {
    /** Total number of plugins with registered WebSocket handlers */
    totalPlugins: number;

    /** Number of plugins with active subscriptions */
    pluginsWithActiveSubscriptions: number;

    /** Total number of unique rooms across all plugins */
    totalRooms: number;

    /** Total number of subscriptions across all plugins */
    totalSubscriptions: number;

    /** Total events emitted by all plugins since startup */
    totalEventsEmitted: number;

    /** Total subscription errors across all plugins since startup */
    totalSubscriptionErrors: number;

    /** Plugin with the most active subscriptions */
    mostActivePlugin?: {
        pluginId: string;
        subscriptionCount: number;
    };

    /** Plugin with the highest event emission rate */
    mostActiveEmitter?: {
        pluginId: string;
        eventsPerMinute: number;
    };
}
