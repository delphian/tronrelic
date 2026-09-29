import type { Socket, Server as SocketIOServer } from 'socket.io';
import type {
    IPluginWebSocketManager,
    PluginSubscriptionHandler,
    PluginUnsubscribeHandler,
    ISystemLogService
} from '@/types';

/** Sent to the client when a plugin rejects a subscription without marking its reason safe to show. */
export const GENERIC_SUBSCRIPTION_ERROR_MESSAGE = 'Subscription rejected';

/**
 * Choose the message a client sees when a plugin rejects its subscription.
 *
 * A plugin handler's error can come from anywhere inside it, including a
 * database or network call, and its text can name collections, hosts, or
 * internal state. Only an error that sets `expose: true` — the same marker
 * the HTTP error handler honours — has its message shown; every other error
 * becomes a fixed string. A plugin that wants to explain a refusal, such as
 * "sign in to see this", throws an error with `expose` set.
 *
 * @param error - Whatever the plugin handler threw.
 * @returns The message to send to the client.
 */
export function clientSafeErrorMessage(error: unknown): string {
    const exposed = error instanceof Error && (error as { expose?: unknown }).expose === true;
    return exposed ? (error as Error).message : GENERIC_SUBSCRIPTION_ERROR_MESSAGE;
}

/**
 * Subscribe-attempt bookkeeping kept on one socket.
 *
 * `next` numbers attempts across every room on the socket, so no two attempts
 * ever share a number. `latest` holds, per prefixed room name, the number of
 * the newest attempt still unsettled.
 */
interface ISubscriptionAttempts {
    next: number;
    latest: Map<string, number>;
}

/**
 * Read or create the attempt bookkeeping on a socket.
 *
 * Stored on `socket.data`, like the subscribe rate limiter's state, so it is
 * discarded with the connection.
 *
 * @param socket - The socket whose attempts are being tracked.
 * @returns The socket's bookkeeping object.
 */
function subscriptionAttempts(socket: Socket): ISubscriptionAttempts {
    const data = socket.data as { subscriptionAttempts?: ISubscriptionAttempts };
    if (!data.subscriptionAttempts) {
        data.subscriptionAttempts = { next: 0, latest: new Map() };
    }
    return data.subscriptionAttempts;
}

/**
 * Number a new subscribe attempt and mark it the newest for its room.
 *
 * Socket.IO starts an async listener for every packet without awaiting the
 * previous one, so two `subscribe` events for the same room overlap whenever a
 * page has more than one holder of that room. Numbering the attempts lets only
 * the newest one undo the join when it fails. Without that, a slow rejection —
 * a transient database error inside a plugin handler, say — removes the
 * membership a later accepted request established, and the client stays out of
 * the room for the rest of the connection while believing it is subscribed.
 *
 * @param socket - The socket making the attempt.
 * @param fullRoomName - Prefixed room name the attempt targets.
 * @returns This attempt's number, unique on the socket.
 */
function beginSubscriptionAttempt(socket: Socket, fullRoomName: string): number {
    const attempts = subscriptionAttempts(socket);
    attempts.next += 1;
    attempts.latest.set(fullRoomName, attempts.next);
    return attempts.next;
}

/**
 * Test whether an attempt is still the newest unsettled one for its room.
 *
 * Undoing a join is only correct while no newer request has taken over. A
 * missing entry also means "not newest": entries are removed only by the newest
 * attempt when it settles, so an older attempt that finds none knows a newer one
 * has already finished. The rejection gate still holds, because a newer attempt
 * that also rejects is itself the newest and removes the membership.
 *
 * @param socket - The socket the attempt was made on.
 * @param fullRoomName - Prefixed room name the attempt targeted.
 * @param attempt - The number {@link beginSubscriptionAttempt} returned.
 * @returns True when no later attempt for the same room has started.
 */
function isLatestSubscriptionAttempt(socket: Socket, fullRoomName: string, attempt: number): boolean {
    return subscriptionAttempts(socket).latest.get(fullRoomName) === attempt;
}

/**
 * Forget a room's entry once its newest attempt has settled.
 *
 * Keeps the bookkeeping sized to the rooms with an attempt in flight, rather
 * than to every room name a socket has ever tried. Only the newest attempt may
 * remove the entry, and attempt numbers are never reused on a socket, so this
 * cannot let a stale attempt pass as the newest.
 *
 * @param socket - The socket the attempt was made on.
 * @param fullRoomName - Prefixed room name the attempt targeted.
 * @param attempt - The number {@link beginSubscriptionAttempt} returned.
 */
function settleSubscriptionAttempt(socket: Socket, fullRoomName: string, attempt: number): void {
    if (isLatestSubscriptionAttempt(socket, fullRoomName, attempt)) {
        subscriptionAttempts(socket).latest.delete(fullRoomName);
    }
}

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
     * Joins the socket to the prefixed room, then invokes the registered subscription handler.
     * Joining first lets a handler send initial data to the room straight away.
     *
     * A handler rejects a subscription by throwing, and the socket is then removed from the room
     * again. Before that removal existed, a throwing handler left the socket joined, so a plugin
     * that gated a room by throwing was silently open to everyone.
     *
     * The client receives `<pluginId>:subscription-error` with a generic message, unless the thrown
     * error sets `expose: true` (the http-errors convention also used by the HTTP error handler),
     * in which case its message is shown. A handler's own error text can carry database or
     * internal details that an anonymous client must not see. This method is not part of the
     * public plugin API.
     *
     * @param socket - The Socket.IO socket instance requesting subscription
     * @param roomName - The plugin-local room name (without prefix)
     * @param payload - Optional subscription payload sent by the client
     * @returns Promise that resolves when subscription handling completes
     * @throws The handler's error, after the client has been told. The socket leaves the room only
     *   when no newer subscribe for the same room has started, so a rejection that resolves late
     *   cannot undo the membership a later accepted request established.
     * @internal
     */
    public async handleSubscription(socket: Socket, roomName: string, payload?: any): Promise<void> {
        if (!this.subscriptionHandler) {
            // Client-triggered: any client can name this plugin, so this is not a server fault.
            this.logger.debug(
                { pluginId: this.pluginId, socketId: socket.id, roomName },
                'Subscription received but no handler registered'
            );
            return;
        }

        const fullRoomName = this.getFullRoomName(roomName);
        const attempt = beginSubscriptionAttempt(socket, fullRoomName);
        try {
            // Automatically join the client to the prefixed room
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
            // Undo the join so throwing actually rejects, as the plugin docs promise. Only the
            // newest attempt for this socket and room may do so: two subscribe events can overlap,
            // and a rejection that resolves after a later request was accepted must not remove the
            // membership that later request established.
            if (isLatestSubscriptionAttempt(socket, fullRoomName, attempt)) {
                socket.leave(fullRoomName);
            }

            this.stats.totalSubscriptionErrors++;
            this.stats.lastSubscriptionErrorAt = new Date();

            const errorMessage = error instanceof Error ? error.message : 'Unknown subscription error';
            // Warn, not error: most rejections are a plugin refusing a client's request (not signed
            // in, bad payload), and a client can send those as fast as its budget allows.
            this.logger.warn(
                { pluginId: this.pluginId, socketId: socket.id, roomName, error: errorMessage },
                'Plugin subscription rejected'
            );

            // Emit error to client using namespaced event
            socket.emit(`${this.pluginId}:subscription-error`, {
                error: clientSafeErrorMessage(error),
                pluginId: this.pluginId,
                roomName
            });

            throw error; // Re-throw so WebSocketService knows the subscription did not happen
        } finally {
            settleSubscriptionAttempt(socket, fullRoomName, attempt);
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
            this.logger.warn(
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
