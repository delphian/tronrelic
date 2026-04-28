import type { IWebSocketService } from '@/types';
import type { Server } from 'http';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import { unsign } from 'cookie-signature';
import type { TronRelicSocketEvent, SocketSubscriptions } from '@/shared';
import { logger } from '../lib/logger.js';
import { PluginWebSocketRegistry } from './plugin-websocket-registry.js';
import { corsOriginCallback } from '../config/cors.js';
import { env } from '../config/env.js';
import { USER_ID_COOKIE_NAME } from '../modules/user/api/identity-cookie.js';

/** UUID v4 format check; mirrors UserService.isValidUUID. */
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Pull the identity UUID out of a handshake Cookie header string.
 *
 * Exported for unit testing; called from `readUserIdFromHandshake` with
 * the live socket's header. Socket.IO doesn't run Express middleware, so
 * cookie-parser isn't available here and we verify the HMAC ourselves via
 * `cookie-signature.unsign`. The expected on-the-wire format for signed
 * cookies is `s:<uuid>.<HMAC>` (cookie-parser convention); URL-encoding
 * adds the `s%3A` prefix that `decodeURIComponent` strips back to `s:`.
 *
 * Returns null on missing, malformed, forged-signature, decode-error, or
 * non-UUID cookie values so the caller can short-circuit cleanly. Legacy
 * unsigned cookies issued before HMAC signing are also accepted — admin
 * auth runs on `req.signedCookies` and never sees identity rooms anyway,
 * so accepting unsigned values here only affects user-room subscriptions
 * and matches the grace-window behavior in `userContextMiddleware`.
 */
export function parseUserIdFromCookieHeader(cookieHeader: string | undefined | null): string | null {
    if (typeof cookieHeader !== 'string' || cookieHeader.length === 0) {
        return null;
    }
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${USER_ID_COOKIE_NAME}=([^;]*)`));
    if (!match) return null;
    let raw: string;
    try {
        raw = decodeURIComponent(match[1]);
    } catch {
        return null;
    }

    // Signed cookies are `s:<uuid>.<HMAC>`. Verify with the same secret
    // cookie-parser uses for Express requests; reject on tamper.
    if (raw.startsWith('s:')) {
        const unsigned = unsign(raw.slice(2), env.SESSION_SECRET ?? '');
        if (unsigned === false) return null;
        return UUID_V4_REGEX.test(unsigned) ? unsigned : null;
    }

    // Legacy unsigned cookies: accept if UUID v4. Admin auth doesn't read
    // this path; only identity-room subscriptions use it.
    return UUID_V4_REGEX.test(raw) ? raw : null;
}

/**
 * Pull the identity UUID out of the handshake's Cookie header.
 *
 * Socket.IO forwards the original HTTP Cookie header on the WebSocket
 * upgrade when the client opts in with `withCredentials: true`. We parse
 * it once at connection time so identity-scoped subscriptions can never
 * be steered by a client-supplied payload field.
 */
function readUserIdFromHandshake(socket: Socket): string | null {
    return parseUserIdFromCookieHeader(socket.handshake.headers.cookie);
}

export class WebSocketService implements IWebSocketService {
  private static instance: WebSocketService;
  private io?: SocketIOServer;

  private constructor() {}

  public static getInstance() {
    if (!WebSocketService.instance) {
      WebSocketService.instance = new WebSocketService();
    }
    return WebSocketService.instance;
  }

  public initialize(server: Server) {
    this.io = new SocketIOServer(server, {
      transports: ['websocket', 'polling'],
      cors: {
        origin: corsOriginCallback,
        credentials: true
      },
      pingInterval: 25000,
      pingTimeout: 20000
    });

    this.io.on('connection', socket => this.handleConnection(socket));

    logger.info('WebSocket server initialized with transports: websocket, polling');
  }

  /**
   * Get the raw Socket.IO server instance.
   *
   * Provides access to the underlying Socket.IO server for plugin managers and
   * advanced use cases. Returns undefined if the server has not been initialized.
   *
   * @returns The Socket.IO server instance or undefined if not initialized
   */
  public getIO(): SocketIOServer | undefined {
    return this.io;
  }

  private handleConnection(socket: Socket) {
    // Resolve user identity from the handshake cookie once at connection
    // time. This is the only trusted source of UUID — the subscribe payload
    // is not consulted for identity-scoped rooms. Stash the resolved value
    // on `socket.data.userId` so plugin managers (and the core subscribe
    // handler below) can read it without re-parsing.
    const cookieUserId = readUserIdFromHandshake(socket);
    socket.data.userId = cookieUserId;

    logger.info({ socketId: socket.id, hasIdentity: cookieUserId !== null }, 'Client connected');

    socket.on('subscribe', (pluginIdOrPayload: string | SocketSubscriptions, roomNameOrPayload?: string | any, optionalPayload?: any) => {
      this.handleSubscription(socket, pluginIdOrPayload, roomNameOrPayload, optionalPayload);
    });

    socket.on('unsubscribe', (pluginIdOrPayload: string | any, roomNameOrPayload?: string | any, optionalPayload?: any) => {
      this.handleUnsubscribe(socket, pluginIdOrPayload, roomNameOrPayload, optionalPayload);
    });

    socket.on('disconnect', reason => {
      logger.info({ socketId: socket.id, reason }, 'Client disconnected');
    });
  }

  /**
   * Handle subscription request from client.
   *
   * Routes subscription requests to both legacy core subscriptions (markets, transactions, etc.)
   * and plugin-specific subscription handlers. Supports three formats:
   *
   * 1. New room-based format: `socket.emit('subscribe', 'plugin-id', 'room-name', { options })`
   * 2. Legacy plugin format: `socket.emit('subscribe', 'plugin-id', { options })`
   * 3. Legacy object format: `socket.emit('subscribe', { 'plugin-id': { options } })`
   *
   * @param socket - The Socket.IO socket instance requesting subscription
   * @param pluginIdOrPayload - Either a plugin ID string (new format) or subscription object (legacy)
   * @param roomNameOrPayload - Either room name (new format) or payload (legacy plugin format)
   * @param optionalPayload - Optional subscription parameters when using new room-based format
   */
  private async handleSubscription(
    socket: Socket,
    pluginIdOrPayload: string | SocketSubscriptions,
    roomNameOrPayload?: string | any,
    optionalPayload?: any
  ) {
    // New room-based format: string plugin ID, string room name, optional payload
    if (typeof pluginIdOrPayload === 'string' && typeof roomNameOrPayload === 'string') {
      const pluginId = pluginIdOrPayload;
      const roomName = roomNameOrPayload;
      const payload = optionalPayload;
      const registry = PluginWebSocketRegistry.getInstance();
      const manager = registry.getManager(pluginId);

      if (manager) {
        try {
          await manager.handleSubscription(socket, roomName, payload);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown plugin subscription error';
          logger.error(
            { pluginId, socketId: socket.id, roomName, error: errorMessage },
            'Plugin subscription handler failed'
          );
          // Error already emitted to client by manager
        }
      } else {
        logger.warn({ pluginId, socketId: socket.id, roomName }, 'No plugin handler found for subscription');
      }
      return;
    }

    // Legacy plugin format: string plugin ID with payload (no room name)
    if (typeof pluginIdOrPayload === 'string') {
      const pluginId = pluginIdOrPayload;
      const payload = roomNameOrPayload; // Second param is payload in legacy format
      const registry = PluginWebSocketRegistry.getInstance();
      const manager = registry.getManager(pluginId);

      if (manager) {
        try {
          // Use plugin ID as default room name for backward compatibility
          await manager.handleSubscription(socket, pluginId, payload || {});
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown plugin subscription error';
          logger.error(
            { pluginId, socketId: socket.id, error: errorMessage },
            'Plugin subscription handler failed (legacy format)'
          );
          // Error already emitted to client by manager
        }
      } else {
        logger.warn({ pluginId, socketId: socket.id }, 'No plugin handler found for subscription');
      }
      return;
    }

    // Legacy format: object with plugin IDs as keys
    const payload = pluginIdOrPayload;

    // Handle core (legacy) subscriptions
    if (payload.markets?.all) {
      socket.join('markets:all');
    }

    payload.markets?.markets?.forEach((marketId: string) => socket.join(`markets:${marketId}`));

    if (payload.transactions) {
      socket.join('transactions:all');
    }

    if (payload.transactions?.minAmount !== undefined) {
      socket.join(`transactions:large:${payload.transactions.minAmount}`);
    }

    payload.transactions?.addresses?.forEach((address: string) => socket.join(`transactions:address:${address}`));

    if (payload.memos?.all) {
      socket.join('memos:all');
    }

    if (payload.comments) {
      socket.join(`comments:${payload.comments.resourceId}`);
    }

    if (payload.chat) {
      socket.join('chat:global');
    }

    if (payload.notifications?.wallet) {
      const walletId = payload.notifications.wallet.trim();
      if (walletId) {
        const walletRoom = `notifications:${walletId}`;
        socket.join(walletRoom);
        logger.debug({ socketId: socket.id, walletRoom }, 'Wallet notification subscription registered');
      }
    }

    // Handle user identity subscriptions. The user id comes exclusively
    // from the cookie resolved at connection time — payload.user.userId is
    // ignored even if a client sends it. This closes the prior bug where a
    // client could subscribe to any user's `user:<uid>` room by sending
    // that uid in the payload.
    if (payload.user) {
      const cookieUserId: string | null = socket.data.userId ?? null;
      if (cookieUserId) {
        const userRoom = `user:${cookieUserId}`;
        socket.join(userRoom);
        logger.debug({ socketId: socket.id, userRoom }, 'User identity subscription registered');
      } else {
        logger.warn({ socketId: socket.id }, 'User subscription requested without identity cookie');
      }
    }

    // Handle plugin subscriptions (legacy object format)
    const registry = PluginWebSocketRegistry.getInstance();
    const pluginIds = registry.getAllPluginIds();

    for (const pluginId of pluginIds) {
      const pluginPayload = (payload as any)[pluginId];
      if (pluginPayload !== undefined) {
        const manager = registry.getManager(pluginId);
        if (manager) {
          try {
            // Use plugin ID as room name for legacy object format
            await manager.handleSubscription(socket, pluginId, pluginPayload);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown plugin subscription error';
            logger.error(
              { pluginId, socketId: socket.id, error: errorMessage },
              'Plugin subscription handler failed (legacy object format)'
            );
            // Error already emitted to client by manager
          }
        }
      }
    }
  }

  /**
   * Handle unsubscribe request from client.
   *
   * Routes unsubscribe requests to plugin-specific handlers. Supports two formats:
   *
   * 1. New room-based format: `socket.emit('unsubscribe', 'plugin-id', 'room-name', { options })`
   * 2. Legacy object format: `socket.emit('unsubscribe', { 'plugin-id': { options } })`
   *
   * Errors are logged but do not prevent unsubscription from completing.
   *
   * @param socket - The Socket.IO socket instance requesting unsubscription
   * @param pluginIdOrPayload - Either a plugin ID string (new format) or unsubscription object (legacy)
   * @param roomNameOrPayload - Either room name (new format) or payload (legacy format)
   * @param optionalPayload - Optional unsubscription parameters when using new room-based format
   */
  private async handleUnsubscribe(
    socket: Socket,
    pluginIdOrPayload: string | any,
    roomNameOrPayload?: string | any,
    optionalPayload?: any
  ) {
    // New room-based format: string plugin ID, string room name, optional payload
    if (typeof pluginIdOrPayload === 'string' && typeof roomNameOrPayload === 'string') {
      const pluginId = pluginIdOrPayload;
      const roomName = roomNameOrPayload;
      const payload = optionalPayload;
      const registry = PluginWebSocketRegistry.getInstance();
      const manager = registry.getManager(pluginId);

      if (manager) {
        try {
          await manager.handleUnsubscribe(socket, roomName, payload);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown plugin unsubscribe error';
          logger.error(
            { pluginId, socketId: socket.id, roomName, error: errorMessage },
            'Plugin unsubscribe handler failed (non-fatal)'
          );
          // Continue - errors don't prevent unsubscription
        }
      } else {
        logger.warn({ pluginId, socketId: socket.id, roomName }, 'No plugin handler found for unsubscription');
      }
      return;
    }

    // Legacy format: object with plugin IDs as keys
    const payload = pluginIdOrPayload;
    const registry = PluginWebSocketRegistry.getInstance();
    const pluginIds = registry.getAllPluginIds();

    for (const pluginId of pluginIds) {
      const pluginPayload = payload[pluginId];
      if (pluginPayload !== undefined) {
        const manager = registry.getManager(pluginId);
        if (manager) {
          try {
            // Use plugin ID as room name for legacy unsubscribe
            await manager.handleUnsubscribe(socket, pluginId, pluginPayload);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown plugin unsubscribe error';
            logger.error(
              { pluginId, socketId: socket.id, error: errorMessage },
              'Plugin unsubscribe handler failed (non-fatal)'
            );
            // Continue processing other plugins
          }
        }
      }
    }
  }

  public emit(event: any) {
    if (!this.io) {
      logger.warn('Attempted to emit without WebSocket initialization');
      return;
    }

    switch (event.event) {
      case 'transaction:large':
      case 'delegation:new':
      case 'stake:new':
        logger.debug('whale-alerts SENDING ALL');
        this.io.to('transactions:all').emit(event.event, event.payload);
        this.io.to(`transactions:address:${event.payload.from.address}`).emit(event.event, event.payload);
        this.io.to(`transactions:address:${event.payload.to.address}`).emit(event.event, event.payload);
        break;
      case 'block:new':
        this.io.emit(event.event, event.payload);
        break;
      case 'comments:new':
        this.io.to(`comments:${event.payload.threadId}`).emit(event.event, event.payload);
        break;
      case 'chat:update':
        this.io.to('chat:global').emit(event.event, event.payload);
        break;
      case 'memo:new':
        this.io.to('memos:all').emit(event.event, event.payload);
        break;
      case 'menu:update':
      case 'menu:namespace-config:update':
        this.io.emit(event.event, event.payload);
        break;
      default:
        logger.warn({ event }, 'Unknown socket event');
    }
  }

  public emitToWallet(wallet: string, event: any) {
    if (!this.io) {
      logger.warn('Attempted to emit wallet notification without WebSocket initialization');
      return;
    }

    const walletId = wallet.trim();
    if (!walletId) {
      logger.warn({ event: event.event }, 'Cannot emit wallet notification without wallet id');
      return;
    }

    const room = `notifications:${walletId}`;
    this.io.to(room).emit(event.event, event.payload);
  }

  /**
   * Emit an event to a specific user identity room.
   *
   * Used to push user updates (wallet linking, preferences changes) to connected clients.
   *
   * @param userId - User UUID to emit to
   * @param event - Event object with event name and payload
   */
  public emitToUser(userId: string, event: { event: string; payload: any }) {
    if (!this.io) {
      logger.warn('Attempted to emit user event without WebSocket initialization');
      return;
    }

    const id = userId.trim();
    if (!id) {
      logger.warn({ event: event.event }, 'Cannot emit user event without user id');
      return;
    }

    const room = `user:${id}`;
    this.io.to(room).emit(event.event, event.payload);
    logger.debug({ userId, event: event.event }, 'User event emitted');
  }
}
