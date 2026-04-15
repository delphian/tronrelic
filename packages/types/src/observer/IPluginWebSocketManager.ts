import type { Socket } from 'socket.io';

/**
 * Subscription handler callback for plugin WebSocket subscriptions.
 *
 * Invoked when a client subscribes to a plugin room. The handler receives the socket
 * instance, the room name, and optional subscription payload. The room name is already
 * stripped of the 'plugin:{pluginId}:' prefix, so plugins see only their local room names.
 * Throwing an error rejects the subscription and emits a standardized error event to the client.
 *
 * @param socket - The Socket.IO socket instance representing the connected client
 * @param roomName - The plugin-local room name (prefix already stripped)
 * @param payload - Optional subscription payload sent by the client (e.g., filters, preferences)
 * @returns Promise that resolves when subscription processing completes
 * @throws Error when subscription validation fails or subscription should be rejected
 */
export type PluginSubscriptionHandler = (socket: Socket, roomName: string, payload?: any) => Promise<void>;

/**
 * Unsubscribe handler callback for plugin WebSocket unsubscriptions.
 *
 * Invoked when a client unsubscribes from a plugin room. The handler receives the socket
 * instance, the room name, and optional unsubscription payload. The room name is already
 * stripped of the 'plugin:{pluginId}:' prefix. Errors are logged but do not prevent
 * unsubscription from completing.
 *
 * @param socket - The Socket.IO socket instance representing the connected client
 * @param roomName - The plugin-local room name (prefix already stripped)
 * @param payload - Optional unsubscription payload sent by the client
 * @returns Promise that resolves when unsubscription processing completes
 */
export type PluginUnsubscribeHandler = (socket: Socket, roomName: string, payload?: any) => Promise<void>;

/**
 * Plugin-scoped WebSocket manager for managing subscriptions, rooms, and events.
 *
 * Provides each plugin with isolated WebSocket capabilities including custom subscription
 * handlers, room management, and namespaced event emission. All room names and event names
 * are automatically prefixed with the plugin ID to prevent namespace collisions, while
 * keeping plugins unaware of this internal namespacing. Plugins can optionally access raw
 * Socket.IO functionality for advanced use cases requiring global room access.
 */
export interface IPluginWebSocketManager {
    /**
     * Register a subscription handler for this plugin.
     *
     * Called when clients subscribe to a room in this plugin. The handler receives the
     * room name (without plugin prefix) and optional payload. The handler validates the
     * subscription request, applies business rules, and the client is automatically joined
     * to the prefixed room. Only one handler can be registered per plugin; subsequent calls
     * override the previous handler. Handlers that throw errors cause the subscription to be
     * rejected and emit an error event to the client.
     *
     * @param handler - Async callback invoked when clients subscribe to a room
     * @example
     * websocket.onSubscribe(async (socket, roomName, payload) => {
     *     // roomName = 'whale-alerts', 'high-value', etc.
     *     const { minAmount = 500_000 } = payload || {};
     *     if (minAmount < 0) throw new Error('Invalid minAmount');
     *
     *     // Client is already joined to 'plugin:whale-alerts:{roomName}'
     *     // Store preferences for filtering
     *     socket.data.filters = { minAmount };
     * });
     */
    onSubscribe(handler: PluginSubscriptionHandler): void;

    /**
     * Register an unsubscribe handler for this plugin.
     *
     * Called when clients unsubscribe from a room in this plugin. The handler receives the
     * room name (without plugin prefix) and optional payload. The client is automatically
     * removed from the room BEFORE the handler runs (matching the subscribe pattern where
     * clients are joined before the handler). This ensures rapid subscribe/unsubscribe/subscribe
     * sequences result in correct final room membership. The handler then cleans up
     * plugin-specific state. Only one handler can be registered per plugin; subsequent calls
     * override the previous handler. Errors are logged but do not prevent unsubscription
     * from completing.
     *
     * @param handler - Async callback invoked when clients unsubscribe from a room
     * @example
     * websocket.onUnsubscribe(async (socket, roomName, payload) => {
     *     // roomName = 'whale-alerts', 'high-value', etc.
     *     // Socket has already left the room at this point
     *     // Clean up socket data
     *     delete socket.data.filters;
     * });
     */
    onUnsubscribe(handler: PluginUnsubscribeHandler): void;

    /**
     * Join a client to a plugin-scoped room.
     *
     * Adds the socket to a room namespaced under this plugin. The actual room name
     * becomes `plugin:{pluginId}:{roomName}`, but plugins remain unaware of this
     * prefixing. Use this for grouping clients that should receive the same events
     * based on subscription criteria (e.g., whale thresholds, token types, etc.).
     *
     * @param socket - The Socket.IO socket instance representing the client to join
     * @param roomName - The plugin-local room name (automatically prefixed internally)
     * @example
     * // Plugin sees: joinRoom(socket, 'whale-500000')
     * // Actual room: 'plugin:whale-alerts:whale-500000'
     * websocket.joinRoom(socket, `whale-${minAmount}`);
     */
    joinRoom(socket: Socket, roomName: string): void;

    /**
     * Remove a client from a plugin-scoped room.
     *
     * Removes the socket from a room namespaced under this plugin. The actual room name
     * is automatically prefixed with the plugin ID, matching the behavior of joinRoom.
     * Safe to call even if the socket is not in the room.
     *
     * @param socket - The Socket.IO socket instance representing the client to remove
     * @param roomName - The plugin-local room name (automatically prefixed internally)
     * @example
     * websocket.leaveRoom(socket, `whale-${minAmount}`);
     */
    leaveRoom(socket: Socket, roomName: string): void;

    /**
     * Emit an event to all clients in a specific plugin-scoped room.
     *
     * Broadcasts an event to all sockets currently joined to the specified room. Both the room
     * name and event name are automatically prefixed with the plugin ID for complete namespace
     * isolation. This prevents event name collisions between different plugins using the same
     * event names.
     *
     * @param roomName - The plugin-local room name to broadcast to (automatically prefixed)
     * @param eventName - The plugin-local event name (automatically prefixed as {pluginId}:{eventName})
     * @param payload - The event data to send to subscribed clients
     * @example
     * // Backend: emitToRoom('large-transfer', 'large-transfer', data)
     * // Actual room: 'plugin:whale-alerts:large-transfer'
     * // Actual event: 'whale-alerts:large-transfer' (PREFIXED)
     * // Frontend: websocket.on('large-transfer', handler) - auto-prefixes to 'whale-alerts:large-transfer'
     * websocket.emitToRoom('large-transfer', 'large-transfer', transaction);
     */
    emitToRoom(roomName: string, eventName: string, payload: any): void;

    /**
     * Emit an event to a specific socket connection.
     *
     * Sends an event directly to one client without using rooms. The event name is
     * automatically prefixed with `{pluginId}:` to ensure namespace isolation. Useful
     * for sending subscription confirmations, validation errors, or client-specific data.
     *
     * @param socket - The Socket.IO socket instance to send the event to
     * @param eventName - The plugin-local event name (automatically prefixed as {pluginId}:{eventName})
     * @param payload - The event data to send to the client
     * @example
     * // Plugin sees: emitToSocket(socket, 'subscribed', { status: 'ok' })
     * // Actual event: 'whale-alerts:subscribed'
     * websocket.emitToSocket(socket, 'subscribed', { minAmount });
     */
    emitToSocket(socket: Socket, eventName: string, payload: any): void;

    /**
     * Get all socket IDs currently in a plugin-scoped room.
     *
     * Returns the set of socket IDs for clients joined to the specified room. The room
     * name is automatically prefixed with the plugin ID. Useful for monitoring subscription
     * counts and debugging room membership.
     *
     * @param roomName - The plugin-local room name to query (automatically prefixed)
     * @returns Promise resolving to a Set of socket IDs in the room
     * @example
     * const sockets = await websocket.getSocketsInRoom(`whale-${threshold}`);
     * console.log(`${sockets.size} clients subscribed to whale-${threshold}`);
     */
    getSocketsInRoom(roomName: string): Promise<Set<string>>;

    /**
     * Get the raw Socket.IO server instance for advanced use cases.
     *
     * Provides direct access to the underlying Socket.IO server, bypassing plugin
     * namespacing. Use this sparingly and only when plugin-scoped methods are insufficient
     * (e.g., broadcasting to global rooms, accessing server-wide stats, or implementing
     * custom middleware). Most plugins should rely on the namespaced methods instead.
     *
     * @returns The Socket.IO server instance or undefined if not initialized
     * @example
     * // Advanced: Emit to a raw room without plugin prefixing
     * const io = websocket.getRawIO();
     * io?.to('global-notifications').emit('system:alert', { message: 'Maintenance soon' });
     */
    getRawIO(): any | undefined;
}
