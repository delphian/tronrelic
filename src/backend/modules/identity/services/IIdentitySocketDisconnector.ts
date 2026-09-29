/**
 * @fileoverview What the identity module needs from the WebSocket layer.
 *
 * A socket's identity rooms (`user:<id>`, `group:<id>`) are chosen once, at
 * the handshake, from the session the browser presented then. Nothing moves a
 * socket out of those rooms afterwards, so a socket opened before sign-out, or
 * before an admin was demoted, keeps receiving that user's notifications and
 * the admin nudges until it happens to reconnect. The official client
 * reconnects on its own; a hostile client need not. Disconnecting the affected
 * sockets forces a fresh handshake, which re-reads the current identity.
 *
 * Declared here as a narrow interface so the identity module depends on the
 * one operation it uses rather than on the whole WebSocket service, and so
 * tests can supply a spy.
 */

/**
 * Forces a user's open WebSocket connections to re-handshake.
 */
export interface IIdentitySocketDisconnector {
    /**
     * Disconnect a user's sockets so each reconnects with its current identity.
     *
     * @param userId - Better Auth user id whose sockets should be dropped.
     * @param sessionId - When given, only sockets opened with this session are
     *   dropped, so signing out on one device leaves the user's other signed-in
     *   devices connected. Omit it when the change applies to every session,
     *   such as a group membership change.
     * @returns Resolves once the matching sockets have been told to disconnect.
     */
    disconnectUser(userId: string, sessionId?: string): Promise<void>;
}
