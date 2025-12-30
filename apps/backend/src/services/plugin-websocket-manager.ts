import type { Socket, Server as SocketIOServer } from 'socket.io';
import type {
    IPluginWebSocketManager,
    PluginSubscriptionHandler,
    PluginUnsubscribeHandler,
    ISystemLogService
} from '@tronrelic/types';

/**
 * Plugin-scoped WebSocket manager implementation.
 *
 * Provides each plugin with isolated WebSocket capabilities including custom subscription
 * handlers, room management, and namespaced event emission. All room names and event names
 * are automatically prefixed with the plugin ID to prevent namespace collisions. Plugins
 * remain unaware of this internal namespacing, receiving the illusion of raw Socket.IO access
 * while benefiting from automatic isolation. Advanced use cases can access the raw Socket.IO
 * instance via getRawIO() for global operations.
 */
export class PluginWebSocketManager implements IPluginWebSocketManager {
    private subscriptionHandler?: PluginSubscriptionHandler;
    private unsubscribeHandler?: PluginUnsubscribeHandler;
    private readonly stats = {
        totalEventsEmitted: 0,
        totalSubscriptionErrors: 0,
        lastEventEmittedAt: undefined as Date | undefined,
        lastSubscriptionErrorAt: undefined as Date | undefined,
        eventTimestamps: [] as number[]
    };

    /**
     * Create a plugin-scoped WebSocket manager.
     *
     * Initializes the manager with plugin-specific context and a reference to the Socket.IO
     * server. The plugin ID is used to namespace all rooms and events, while the logger
     * ensures all WebSocket activity is traceable to the owning plugin.
     *
     * @param pluginId - The unique plugin identifier used for namespacing rooms and events
     * @param io - The Socket.IO server instance for accessing rooms and emitting events
     * @param logger - Scoped logger for emitting structured logs with plugin metadata
     */
    constructor(
        private readonly pluginId: string,
        private readonly io: SocketIOServer,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Register a subscription handler for this plugin.
     *
     * Called when clients emit 'subscribe' with data matching { [pluginId]: payload }.
     * Only one handler can be registered per plugin; subsequent calls override the previous
     * handler. Handlers that throw errors cause the subscription to be rejected and emit an
     * error event to the client.
     *
     * @param handler - Async callback invoked when clients subscribe to this plugin
     */
    public onSubscribe(handler: PluginSubscriptionHandler): void {
        this.subscriptionHandler = handler;
        this.logger.debug(
            { pluginId: this.pluginId },
            'Plugin subscription handler registered'
        );
    }

    /**
     * Register an unsubscribe handler for this plugin.
     *
     * Called when clients emit 'unsubscribe' with data matching { [pluginId]: payload }.
     * Only one handler can be registered per plugin; subsequent calls override the previous
     * handler. Errors are logged but do not prevent unsubscription from completing.
     *
     * @param handler - Async callback invoked when clients unsubscribe from this plugin
     */
    public onUnsubscribe(handler: PluginUnsubscribeHandler): void {
        this.unsubscribeHandler = handler;
        this.logger.debug(
            { pluginId: this.pluginId },
            'Plugin unsubscribe handler registered'
        );
    }

    /**
     * Join a client to a plugin-scoped room.
     *
     * Adds the socket to a room namespaced under this plugin. The actual room name
     * becomes `plugin:{pluginId}:{roomName}`, but plugins remain unaware of this
     * prefixing. Use this for grouping clients that should receive the same events.
     *
     * @param socket - The Socket.IO socket instance representing the client to join
     * @param roomName - The plugin-local room name (automatically prefixed internally)
     */
    public joinRoom(socket: Socket, roomName: string): void {
        const fullRoomName = this.getFullRoomName(roomName);
        socket.join(fullRoomName);
        this.logger.debug(
            { pluginId: this.pluginId, socketId: socket.id, roomName, fullRoomName },
            'Socket joined plugin room'
        );
    }

    /**
     * Remove a client from a plugin-scoped room.
     *
     * Removes the socket from a room namespaced under this plugin. Safe to call even
     * if the socket is not in the room.
     *
     * @param socket - The Socket.IO socket instance representing the client to remove
     * @param roomName - The plugin-local room name (automatically prefixed internally)
     */
    public leaveRoom(socket: Socket, roomName: string): void {
        const fullRoomName = this.getFullRoomName(roomName);
        socket.leave(fullRoomName);
        this.logger.debug(
            { pluginId: this.pluginId, socketId: socket.id, roomName, fullRoomName },
            'Socket left plugin room'
        );
    }

    /**
     * Emit an event to all clients in a specific plugin-scoped room.
     *
     * Broadcasts an event to all sockets currently joined to the specified room. Both the room
     * name and event name are automatically prefixed with the plugin ID for complete namespace
     * isolation. This prevents event name collisions between plugins.
     *
     * @param roomName - The plugin-local room name to broadcast to (automatically prefixed)
     * @param eventName - The plugin-local event name (automatically prefixed as {pluginId}:{eventName})
     * @param payload - The event data to send to subscribed clients
     */
    public emitToRoom(roomName: string, eventName: string, payload: any): void {
        const fullRoomName = this.getFullRoomName(roomName);
        const fullEventName = `${this.pluginId}:${eventName}`;

        this.io.to(fullRoomName).emit(fullEventName, payload);
        this.trackEventEmission();
    }

    /**
     * Emit an event to a specific socket connection.
     *
     * Sends an event directly to one client without using rooms. The event name is
     * automatically prefixed with `{pluginId}:` to ensure namespace isolation.
     *
     * @param socket - The Socket.IO socket instance to send the event to
     * @param eventName - The plugin-local event name (automatically prefixed as {pluginId}:{eventName})
     * @param payload - The event data to send to the client
     */
    public emitToSocket(socket: Socket, eventName: string, payload: any): void {
        const fullEventName = this.getFullEventName(eventName);

        socket.emit(fullEventName, payload);

        this.trackEventEmission();
        this.logger.debug(
            { pluginId: this.pluginId, socketId: socket.id, eventName, fullEventName },
            'Event emitted to specific socket'
        );
    }

    /**
     * Get all socket IDs currently in a plugin-scoped room.
     *
     * Returns the set of socket IDs for clients joined to the specified room. Useful
     * for monitoring subscription counts and debugging room membership.
     *
     * @param roomName - The plugin-local room name to query (automatically prefixed)
     * @returns Promise resolving to a Set of socket IDs in the room
     */
    public async getSocketsInRoom(roomName: string): Promise<Set<string>> {
        const fullRoomName = this.getFullRoomName(roomName);
        return await this.io.in(fullRoomName).allSockets();
    }

    /**
     * Get the raw Socket.IO server instance for advanced use cases.
     *
     * Provides direct access to the underlying Socket.IO server, bypassing plugin
     * namespacing. Use sparingly and only when plugin-scoped methods are insufficient.
     *
     * @returns The Socket.IO server instance
     */
    public getRawIO(): SocketIOServer {
        return this.io;
    }

    /**
     * Handle subscription request for this plugin.
     *
     * Internal method called by WebSocketService when a client subscribes to a room in this plugin.
     * Automatically joins the socket to the prefixed room, invokes the registered subscription handler,
     * and emits errors to the client on failure. This method is not part of the public plugin API.
     *
     * @param socket - The Socket.IO socket instance requesting subscription
     * @param roomName - The plugin-local room name (without prefix)
     * @param payload - Optional subscription payload sent by the client
     * @returns Promise that resolves when subscription handling completes
     * @internal
     */
    public async handleSubscription(socket: Socket, roomName: string, payload?: any): Promise<void> {
        if (!this.subscriptionHandler) {
            this.logger.warn(
                { pluginId: this.pluginId, socketId: socket.id, roomName },
                'Subscription received but no handler registered'
            );
            return;
        }

        try {
            // Automatically join the client to the prefixed room
            const fullRoomName = this.getFullRoomName(roomName);
            socket.join(fullRoomName);
            this.logger.debug(
                { pluginId: this.pluginId, socketId: socket.id, roomName, fullRoomName },
                'Socket auto-joined to plugin room'
            );

            // Invoke plugin handler for validation/configuration
            await this.subscriptionHandler(socket, roomName, payload);

            this.logger.debug(
                { pluginId: this.pluginId, socketId: socket.id, roomName },
                'Plugin subscription successful'
            );
        } catch (error) {
            this.stats.totalSubscriptionErrors++;
            this.stats.lastSubscriptionErrorAt = new Date();

            const errorMessage = error instanceof Error ? error.message : 'Unknown subscription error';
            this.logger.error(
                { pluginId: this.pluginId, socketId: socket.id, roomName, error: errorMessage },
                'Plugin subscription failed'
            );

            // Emit error to client using namespaced event
            socket.emit(`${this.pluginId}:subscription-error`, {
                error: errorMessage,
                pluginId: this.pluginId,
                roomName
            });

            throw error; // Re-throw so WebSocketService can log system-wide
        }
    }

    /**
     * Handle unsubscribe request for this plugin.
     *
     * Internal method called by WebSocketService when a client unsubscribes from a room in this plugin.
     * Automatically removes the socket from the prefixed room BEFORE invoking the registered unsubscribe
     * handler. This mirrors handleSubscription's join-first pattern, ensuring that rapid
     * subscribe/unsubscribe/subscribe sequences result in the correct final room membership state.
     * Logs errors without failing. This method is not part of the public plugin API.
     *
     * @param socket - The Socket.IO socket instance requesting unsubscription
     * @param roomName - The plugin-local room name (without prefix)
     * @param payload - Optional unsubscription payload sent by the client
     * @returns Promise that resolves when unsubscription handling completes
     * @internal
     */
    public async handleUnsubscribe(socket: Socket, roomName: string, payload?: any): Promise<void> {
        // Leave the room FIRST (synchronously) to match handleSubscription's join-first pattern.
        // This ensures room operations happen in event arrival order even when handlers are async.
        const fullRoomName = this.getFullRoomName(roomName);
        socket.leave(fullRoomName);
        this.logger.debug(
            { pluginId: this.pluginId, socketId: socket.id, roomName, fullRoomName },
            'Socket auto-left plugin room'
        );

        if (!this.unsubscribeHandler) {
            this.logger.debug(
                { pluginId: this.pluginId, socketId: socket.id, roomName },
                'Unsubscribe received but no handler registered'
            );
            return;
        }

        try {
            await this.unsubscribeHandler(socket, roomName, payload);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown unsubscribe error';
            this.logger.error(
                { pluginId: this.pluginId, socketId: socket.id, error: errorMessage },
                'Plugin unsubscribe failed (non-fatal)'
            );
            // Don't throw - unsubscribe errors are non-fatal
        }
    }

    /**
     * Get statistics for this plugin's WebSocket activity.
     *
     * Internal method used by PluginWebSocketRegistry for admin monitoring. Returns
     * subscription counts, room stats, emission rates, and error counts. This method
     * is not part of the public plugin API.
     *
     * @returns Promise resolving to plugin WebSocket statistics
     * @internal
     */
    public async getStats(): Promise<{
        hasSubscriptionHandler: boolean;
        hasUnsubscribeHandler: boolean;
        totalEventsEmitted: number;
        totalSubscriptionErrors: number;
        lastEventEmittedAt?: string;
        lastSubscriptionErrorAt?: string;
        eventsPerMinute: number;
        rooms: Array<{ roomName: string; fullRoomName: string; memberCount: number }>;
    }> {
        // Calculate events per minute from recent timestamps
        const now = Date.now();
        const oneMinuteAgo = now - 60_000;
        const recentEvents = this.stats.eventTimestamps.filter(ts => ts > oneMinuteAgo);
        const eventsPerMinute = recentEvents.length;

        // Get all rooms for this plugin
        const rooms: Array<{ roomName: string; fullRoomName: string; memberCount: number }> = [];
        const allRooms = await this.io.in(`plugin:${this.pluginId}:*`).allSockets();

        // Extract room membership (Socket.IO tracks rooms per socket, we need to aggregate)
        const roomMembership = new Map<string, Set<string>>();
        for (const socketId of allRooms) {
            const socket = this.io.sockets.sockets.get(socketId);
            if (socket) {
                for (const room of socket.rooms) {
                    if (room.startsWith(`plugin:${this.pluginId}:`)) {
                        if (!roomMembership.has(room)) {
                            roomMembership.set(room, new Set());
                        }
                        roomMembership.get(room)!.add(socketId);
                    }
                }
            }
        }

        // Build room stats
        for (const [fullRoomName, members] of roomMembership.entries()) {
            const roomName = fullRoomName.replace(`plugin:${this.pluginId}:`, '');
            rooms.push({
                roomName,
                fullRoomName,
                memberCount: members.size
            });
        }

        return {
            hasSubscriptionHandler: !!this.subscriptionHandler,
            hasUnsubscribeHandler: !!this.unsubscribeHandler,
            totalEventsEmitted: this.stats.totalEventsEmitted,
            totalSubscriptionErrors: this.stats.totalSubscriptionErrors,
            lastEventEmittedAt: this.stats.lastEventEmittedAt?.toISOString(),
            lastSubscriptionErrorAt: this.stats.lastSubscriptionErrorAt?.toISOString(),
            eventsPerMinute,
            rooms
        };
    }

    /**
     * Get the fully namespaced room name.
     *
     * Converts a plugin-local room name into the full namespaced room name used
     * internally by Socket.IO. Format: `plugin:{pluginId}:{roomName}`.
     *
     * @param roomName - The plugin-local room name
     * @returns The fully namespaced room name
     */
    private getFullRoomName(roomName: string): string {
        return `plugin:${this.pluginId}:${roomName}`;
    }

    /**
     * Get the fully namespaced event name.
     *
     * Converts a plugin-local event name into the full namespaced event name used
     * for client communication. Format: `{pluginId}:{eventName}`.
     *
     * @param eventName - The plugin-local event name
     * @returns The fully namespaced event name
     */
    private getFullEventName(eventName: string): string {
        return `${this.pluginId}:${eventName}`;
    }

    /**
     * Track event emission for statistics.
     *
     * Records the current timestamp for event rate calculation and updates emission
     * counters. Maintains a rolling window of timestamps for the last minute.
     */
    private trackEventEmission(): void {
        const now = Date.now();
        this.stats.totalEventsEmitted++;
        this.stats.lastEventEmittedAt = new Date();
        this.stats.eventTimestamps.push(now);

        // Keep only last minute of timestamps
        const oneMinuteAgo = now - 60_000;
        this.stats.eventTimestamps = this.stats.eventTimestamps.filter(ts => ts > oneMinuteAgo);
    }
}
