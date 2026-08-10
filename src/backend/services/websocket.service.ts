import type { IWebSocketService } from '@/types';
import { ADMIN_GROUP_ID } from '@/types';
import type { Server } from 'http';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import type { TronRelicSocketEvent, SocketSubscriptions } from '@/shared';
import { logger } from '../lib/logger.js';
import { PluginWebSocketRegistry } from './plugin-websocket-registry.js';
import { corsOriginCallback } from '../config/cors.js';
import type { IncomingHttpHeaders } from 'node:http';
import { getSessionFromHeaders, type IAugmentedSession } from '../modules/identity/services/auth-facade.js';

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

    // Phase 2: resolve the Better Auth session during the handshake
    // and stash the augmented payload on `socket.data.authSession`
    // before the `connection` event fires. Plugin WS handlers and
    // room-gating logic read it as `socket.data.authSession` without
    // rehydrating. Failures degrade to `null` so anonymous connections
    // (which are the common case) are never blocked by an auth-tier hiccup.
    //
    // One retry before giving up. Since identity rooms are now load-bearing —
    // admin-scoped events reach only `group:admin` — a resolution that throws
    // costs a signed-in operator their live updates for the life of the socket,
    // with nothing on screen to say so. The client re-handshakes when its own
    // session changes, but a transient Better Auth / Mongo blip changes nothing
    // client-side, so this is the only place the recovery can happen. A retry
    // is cheap and covers the momentary faults that make up most of this class;
    // a resolution still failing on the second attempt is logged loudly enough
    // to correlate with a reported "the dashboard stopped updating".
    this.io.use(async (socket, next) => {
      socket.data.authSession = await this.resolveHandshakeSession(socket.handshake.headers, socket.id);
      next();
    });

    this.io.on('connection', socket => this.handleConnection(socket));

    logger.info('WebSocket server initialized with transports: websocket, polling');
  }

  /**
   * Resolve a connecting socket's Better Auth session, retrying once.
   *
   * Split out of the handshake middleware so the retry policy is stated in one
   * place and can be reasoned about on its own. The distinction that matters:
   * an *anonymous* visitor resolves to `null` without throwing, so a throw here
   * always means the auth tier itself faltered — never "no cookie". That is
   * worth a second attempt, because the cost of accepting it is a signed-in
   * operator connected with no identity rooms, which reads on screen as a
   * dashboard that quietly stopped refreshing.
   *
   * Still returns `null` rather than rejecting the connection when both
   * attempts fail: refusing the handshake would take the socket down for
   * anonymous and authenticated visitors alike over a fault that only degrades
   * one of them. Degraded-but-connected is the better failure here, and the
   * error log is what makes it diagnosable.
   *
   * @param headers - The handshake's raw headers, carrying the BA session cookie.
   * @param socketId - Connecting socket id, for log correlation.
   * @returns The augmented session, or null when anonymous or unresolvable.
   */
  private async resolveHandshakeSession(
    headers: IncomingHttpHeaders,
    socketId: string
  ): Promise<IAugmentedSession | null> {
    let session: IAugmentedSession | null = null;
    try {
      session = await getSessionFromHeaders(headers);
    } catch (firstError) {
      logger.warn({ error: firstError, socketId }, 'WS handshake BA session resolution failed; retrying once');
      try {
        session = await getSessionFromHeaders(headers);
      } catch (retryError) {
        logger.error(
          { error: retryError, socketId },
          'WS handshake BA session resolution failed twice; socket connects without identity rooms and will not receive user- or group-targeted events until it reconnects'
        );
        session = null;
      }
    }
    return session;
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
    logger.info({ socketId: socket.id }, 'Client connected');

    // Identity rooms. The handshake middleware already resolved the Better
    // Auth session onto `socket.data.authSession`; join the socket to a room
    // keyed by its user id and one per group so the notifications module can
    // fan out to a specific person or group without the client subscribing.
    // Per-user silencing is enforced upstream by emitting only to the
    // `user:${id}` rooms of recipients who have not opted out — so identity
    // delivery never depends on the client asking for it.
    this.joinIdentityRooms(socket);

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
   * Join a freshly connected socket to its identity rooms.
   *
   * Reads the augmented session stashed during the handshake. A logged-in
   * socket joins `user:${userId}` (for person-targeted delivery) and
   * `group:${groupId}` for each group (for future group-wide broadcasts).
   * Anonymous sockets (`authSession === null`) join nothing — they are never
   * a notification target. Kept defensive: a malformed session degrades to no
   * rooms rather than throwing inside the connection handler.
   *
   * @param socket - The connecting socket carrying `data.authSession`.
   */
  private joinIdentityRooms(socket: Socket): void {
    const session = (socket.data as { authSession?: { user?: { id?: string }; groups?: string[] } | null }).authSession;
    const userId = session?.user?.id;
    if (!userId) {
      return;
    }

    socket.join(`user:${userId}`);
    if (Array.isArray(session?.groups)) {
      for (const groupId of session!.groups) {
        if (typeof groupId === 'string' && groupId) {
          socket.join(`group:${groupId}`);
        }
      }
    }
    logger.debug({ socketId: socket.id, userId }, 'Joined identity rooms');
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
      case 'widgets:placements-update':
        // Broadcast to every connected socket. Widget placements
        // affect public render order, so non-admin clients must
        // refetch their widget data to see operator changes.
        this.io.emit(event.event, event.payload);
        break;
      case 'ai-tools:activity':
      case 'ai-tools:approvals-changed':
      case 'curation:changed':
      case 'price-history:stats':
        // Refetch nudges for admin-only surfaces: the AI tool governor, the
        // curation service, and the price-history ingestion tick. Every
        // subscriber lives under /system/*, so these go to the `admin` group
        // room rather than to every connected socket.
        //
        // The payloads are already timestamp-or-count only, so this is not
        // fixing a live leak — it removes one. A global emit told any anonymous
        // visitor when a tool ran or an approval moved, which is a usable
        // timing signal for someone probing prompt injection, and it woke every
        // browser on the site to deliver a timestamp to one or two operators.
        // It also kept the blast radius wrong: `emit` takes `payload: any`, so
        // the day someone widens one of these payloads, the global form
        // publishes governed data to the public internet where this form
        // reaches only admins. The detail itself always stays behind each
        // surface's requireAdmin REST endpoint.
        //
        // The room is populated at handshake time by joinIdentityRooms, and
        // SocketBridge reconnects the socket when the session user changes, so
        // an operator who signs in mid-session lands in the room without a
        // page reload.
        this.io.to(`group:${ADMIN_GROUP_ID}`).emit(event.event, event.payload);
        break;
      case 'account-history:stats':
        // Deliberately NOT admin-scoped. Besides the /system/account-history
        // dashboard, this nudge is consumed by WalletManager on a signed-in
        // user's own profile, which refetches that person's wallet sync
        // progress when an ingestion tick lands. Identity rooms cover one user
        // or one group, so there is no room meaning "every authenticated
        // socket" to narrow this to. The payload is a stats summary carrying no
        // per-account data, and each client still reads its own authoritative
        // progress over an authenticated REST call.
        this.io.emit(event.event, event.payload);
        break;
      case 'content:published':
        // Emitted by the internal publish sink, whose declared reach is
        // `audience: 'admin'`, but which currently has no subscriber at all —
        // core, frontend, or plugin. Left global pending a decision about its
        // intended consumer rather than narrowed on the strength of the sink's
        // own declaration; a signal nobody listens to is the one case where
        // guessing the audience buys nothing.
        this.io.emit(event.event, event.payload);
        break;
      case 'toast':
        // Site-wide toast broadcast from the core `send-toast` AI tool. Every
        // connected browser surfaces it via CoreToastHandler. The payload
        // carries only display fields (tone/title/description/duration) — never
        // governed data — so a global broadcast is safe.
        this.io.emit(event.event, event.payload);
        break;
      case 'notification':
        // Identity-targeted notification fan-out from the notifications module.
        // `event.rooms` is the resolved set of `user:${id}` rooms — already
        // filtered by the dispatch pipeline so silenced recipients are absent.
        // One generic case serves every category forever (categories are data,
        // not new event cases); empty rooms means fully suppressed, a safe
        // no-op. The payload carries only display fields, never governed data.
        if (Array.isArray(event.rooms) && event.rooms.length > 0) {
          // Pass the whole room array to `to()` so Socket.IO encodes one packet
          // and dedupes recipients across rooms in a single broadcast, rather
          // than issuing one broadcast per room. The `length > 0` guard is
          // load-bearing: `io.to([])` produces an empty room set, which the
          // adapter treats as "broadcast to everyone" — an empty recipient list
          // must stay a no-op (fully-suppressed notification).
          this.io.to(event.rooms).emit(event.event, event.payload);
        }
        break;
      default:
        logger.warn({ event }, 'Unknown socket event');
    }
  }

  /**
   * Emit an event to a single connected socket.
   *
   * Socket.IO auto-creates a per-socket room keyed by the socket id, so
   * `io.to(socketId)` targets exactly that one client. Used to scope streamed
   * AI response chunks to the requesting browser instead of broadcasting them
   * to every connected session — a chunk may contain governed data, so a global
   * broadcast would leak it to other admins on the shared socket.
   *
   * @param socketId - The id of the target socket (the client's `getSocket().id`).
   * @param event - The event name to emit.
   * @param payload - The event payload delivered to the target socket.
   */
  public emitToSocket(socketId: string, event: string, payload: unknown): void {
    if (!this.io) {
      logger.warn('Attempted to emit to socket without WebSocket initialization');
      return;
    }

    this.io.to(socketId).emit(event, payload);
  }

  /**
   * Resolve the Better Auth user id that owns a connected socket.
   *
   * Exists so a caller about to push privileged data at one socket can first
   * prove that socket belongs to the person asking for it. The streaming AI
   * query endpoint takes its target socket id from the request body, and
   * without an ownership check an authenticated operator could aim someone
   * else's browser at their own query transcript — answer text, tool
   * arguments, and tool results included.
   *
   * The answer comes from the session stashed on `socket.data.authSession`
   * during the handshake, so it reflects who the browser was authenticated as
   * when it connected: a socket opened before sign-in reads as anonymous until
   * it reconnects. Lookup is scoped to the sockets this process holds, which
   * matches {@link emitToSocket} — that method can only reach a locally-held
   * socket either way, so both agree on which sockets exist.
   *
   * @param socketId - The socket id to look up, as the client reported it.
   * @returns The owning user id, or null when the socket is unknown to this
   *          process, anonymous, or the server is not initialized.
   */
  public getSocketUserId(socketId: string): string | null {
    const socket = this.io?.sockets.sockets.get(socketId);
    const session = (socket?.data as { authSession?: { user?: { id?: string } } | null } | undefined)?.authSession;
    return session?.user?.id ?? null;
  }

}
