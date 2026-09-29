import type { IWebSocketService } from '@/types';
import { ADMIN_GROUP_ID } from '@/types';
import type { Server } from 'http';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import type { TronRelicSocketEvent, SocketSubscriptions } from '@/shared';
import { logger } from '../lib/logger.js';
import { PluginWebSocketRegistry } from './plugin-websocket-registry.js';
import { GENERIC_SUBSCRIPTION_ERROR_MESSAGE } from './plugin-websocket-manager.js';
import { corsOriginCallback } from '../config/cors.js';
import type { IncomingHttpHeaders } from 'node:http';
import { getSessionFromHeaders, type IAugmentedSession } from '../modules/identity/services/auth-facade.js';
import type { IIdentitySocketDisconnector } from '../modules/identity/services/IIdentitySocketDisconnector.js';

/**
 * Most rooms a single socket may join at a client's request (plugin rooms plus
 * the legacy `memos:all`). Every room is an adapter entry held for the life of
 * the connection, and nothing else bounded how many one client could ask for;
 * the busiest real page joins a handful. Rooms the server joins on the
 * client's behalf — its own id room and its identity rooms — do not count.
 */
export const MAX_CLIENT_ROOMS_PER_SOCKET = 50;

/**
 * Longest plugin id or room name accepted from a client. Room names are map
 * keys held in memory; the longest in real use (universe's `cp-v1:<address>`)
 * is 40 characters.
 */
export const MAX_ROOM_NAME_LENGTH = 64;

/**
 * Characters a client-supplied plugin id or room name may contain. Every
 * name in real use fits; anything else is either a mistake or an attempt to
 * smuggle something into a room key or a log line.
 */
const ROOM_NAME_PATTERN = /^[A-Za-z0-9:_.-]+$/;

/** Length of the per-socket window that subscribe and unsubscribe events are counted in. */
export const SUBSCRIBE_RATE_WINDOW_MS = 10_000;

/**
 * Subscribe plus unsubscribe events one socket may send per window. Each one
 * can run a plugin handler, and some handlers query a database, so an
 * unbounded stream from one client is a cheap way to load the server. A page
 * load or reconnect sends well under this; events beyond it are dropped.
 */
export const SUBSCRIBE_RATE_MAX_EVENTS = 30;

/**
 * Largest single message a client may send, in bytes. Clients only ever send
 * `subscribe` and `unsubscribe`, whose payloads are a few hundred bytes;
 * Socket.IO's 1 MB default let one message carry tens of thousands of room
 * names.
 */
export const MAX_HTTP_BUFFER_SIZE_BYTES = 16 * 1024;

/**
 * Test whether a value is a plain object that can be read as a subscription payload.
 *
 * Socket.IO delivers whatever the client sent, so a payload can be null, a
 * string, a number, or an array. Reading a property off any of those is how a
 * single malformed message used to throw inside an async handler and crash
 * the process.
 *
 * @param value - Anything a client sent.
 * @returns True for a non-null, non-array object.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Test whether a client-supplied plugin id or room name is acceptable.
 *
 * @param value - Anything a client sent in a plugin id or room name position.
 * @returns True for a string of 1–{@link MAX_ROOM_NAME_LENGTH} characters
 *   from {@link ROOM_NAME_PATTERN}.
 */
export function isValidRoomToken(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_ROOM_NAME_LENGTH
    && ROOM_NAME_PATTERN.test(value);
}

/**
 * Count the rooms a socket joined at a client's request.
 *
 * Plugin rooms (`plugin:*`) and the legacy `memos:all` are the only rooms a
 * client can ask for, so those are what the per-socket cap counts. The
 * socket's own id room and its `user:`/`group:` identity rooms are joined by
 * the server and excluded.
 *
 * @param socket - The socket whose rooms to count.
 * @returns Number of client-requested rooms the socket is in.
 */
function countClientRooms(socket: Socket): number {
  let count = 0;
  for (const room of socket.rooms) {
    if (room.startsWith('plugin:') || room === 'memos:all') {
      count++;
    }
  }
  return count;
}

/**
 * Charge one subscribe or unsubscribe event against the socket's budget.
 *
 * A fixed window per socket, kept on `socket.data` so it disappears with the
 * connection. Fixed rather than sliding because the aim is a hard ceiling on
 * cost, not smooth pacing.
 *
 * @param socket - The socket sending the event.
 * @param now - Current time in milliseconds; injectable for tests.
 * @returns True when the event is within budget and should be handled.
 */
export function consumeSubscribeBudget(socket: Socket, now: number = Date.now()): boolean {
  const data = socket.data as { subscribeWindowStart?: number; subscribeWindowCount?: number };
  if (data.subscribeWindowStart === undefined || now - data.subscribeWindowStart >= SUBSCRIBE_RATE_WINDOW_MS) {
    data.subscribeWindowStart = now;
    data.subscribeWindowCount = 0;
  }
  data.subscribeWindowCount = (data.subscribeWindowCount ?? 0) + 1;
  return data.subscribeWindowCount <= SUBSCRIBE_RATE_MAX_EVENTS;
}

export class WebSocketService implements IWebSocketService, IIdentitySocketDisconnector {
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
      pingTimeout: 20000,
      maxHttpBufferSize: MAX_HTTP_BUFFER_SIZE_BYTES
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

  /**
   * Wire a newly connected socket: identity rooms, then the client's
   * subscribe and unsubscribe listeners.
   *
   * The two handlers are async and Socket.IO does not await listeners, so an
   * error thrown inside one used to become an unhandled promise rejection,
   * which stops the Node process. One malformed `subscribe` from an anonymous
   * client could take the backend down. Each call now ends in `.catch()`, and
   * the handlers themselves validate input before reading it.
   *
   * Connect and disconnect are logged at debug: they happen for every visitor,
   * the log is persisted to MongoDB and capped, and a flood of them would push
   * real errors out of it.
   *
   * @param socket - The socket that just completed its handshake.
   */
  private handleConnection(socket: Socket) {
    logger.debug({ socketId: socket.id }, 'Client connected');

    // Identity rooms. The handshake middleware already resolved the Better
    // Auth session onto `socket.data.authSession`; join the socket to a room
    // keyed by its user id and one per group so the notifications module can
    // fan out to a specific person or group without the client subscribing.
    // Per-user silencing is enforced upstream by emitting only to the
    // `user:${id}` rooms of recipients who have not opted out — so identity
    // delivery never depends on the client asking for it.
    this.joinIdentityRooms(socket);

    socket.on('subscribe', (pluginIdOrPayload?: unknown, roomNameOrPayload?: unknown, optionalPayload?: unknown) => {
      this.handleSubscription(socket, pluginIdOrPayload, roomNameOrPayload, optionalPayload).catch((error: unknown) => {
        logger.warn({ error, socketId: socket.id }, 'Subscribe handler failed');
      });
    });

    socket.on('unsubscribe', (pluginIdOrPayload?: unknown, roomNameOrPayload?: unknown, optionalPayload?: unknown) => {
      this.handleUnsubscribe(socket, pluginIdOrPayload, roomNameOrPayload, optionalPayload).catch((error: unknown) => {
        logger.warn({ error, socketId: socket.id }, 'Unsubscribe handler failed');
      });
    });

    socket.on('disconnect', reason => {
      logger.debug({ socketId: socket.id, reason }, 'Client disconnected');
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
   * Handle a subscription request from a client.
   *
   * Everything a client sends is treated as untrusted and checked before it is
   * read: arguments of the wrong type are ignored, plugin ids and room names
   * must pass {@link isValidRoomToken}, the socket must be within its
   * subscribe budget, and it may not hold more than
   * {@link MAX_CLIENT_ROOMS_PER_SOCKET} client-requested rooms. Supports three
   * formats:
   *
   * 1. Room-based: `socket.emit('subscribe', 'plugin-id', 'room-name', { options })`
   * 2. Legacy plugin: `socket.emit('subscribe', 'plugin-id', { options })` — the room is the plugin id
   * 3. Legacy object: `socket.emit('subscribe', { memos: { all: true }, 'plugin-id': { options } })`
   *
   * The legacy object format's other core keys (`markets`, `transactions`,
   * `comments`, `chat`, `notifications`) were removed: nothing on the server
   * sent to those rooms, and `notifications:<wallet>` would have delivered one
   * wallet's events to anyone who asked for them the day something did.
   *
   * @param socket - The Socket.IO socket requesting the subscription.
   * @param pluginIdOrPayload - A plugin id (formats 1 and 2) or the legacy object (format 3).
   * @param roomNameOrPayload - The room name (format 1) or the plugin payload (format 2).
   * @param optionalPayload - The plugin payload in format 1.
   * @returns Resolves when handling finishes; never rejects for client input.
   */
  private async handleSubscription(
    socket: Socket,
    pluginIdOrPayload?: unknown,
    roomNameOrPayload?: unknown,
    optionalPayload?: unknown
  ): Promise<void> {
    if (!consumeSubscribeBudget(socket)) {
      logger.debug({ socketId: socket.id }, 'Subscribe dropped: socket over its event budget');
    } else if (typeof pluginIdOrPayload === 'string') {
      // Formats 1 and 2. In format 2 the plugin id doubles as the room name.
      const roomName = typeof roomNameOrPayload === 'string' ? roomNameOrPayload : pluginIdOrPayload;
      // Format 2 has always handed plugins `{}` when the client sent no payload.
      const payload = typeof roomNameOrPayload === 'string' ? optionalPayload : (roomNameOrPayload ?? {});
      await this.subscribeToPluginRoom(socket, pluginIdOrPayload, roomName, payload);
    } else if (isPlainObject(pluginIdOrPayload)) {
      await this.handleLegacyObjectSubscription(socket, pluginIdOrPayload as SocketSubscriptions & Record<string, unknown>);
    } else {
      logger.debug({ socketId: socket.id }, 'Subscribe ignored: payload is not a plugin id or an object');
    }
  }

  /**
   * Handle the legacy object subscription format.
   *
   * `memos.all` is the one core key still honoured, because the alert service
   * emits `memo:new` to `memos:all`. Every other key is looked up only among
   * registered plugin ids, so a client cannot name an arbitrary room here.
   *
   * @param socket - The subscribing socket.
   * @param payload - The client's object, already known to be a plain object.
   * @returns Resolves when every recognised key has been handled.
   */
  private async handleLegacyObjectSubscription(
    socket: Socket,
    payload: SocketSubscriptions & Record<string, unknown>
  ): Promise<void> {
    const memos = payload.memos as unknown;
    if (isPlainObject(memos) && memos.all === true && !socket.rooms.has('memos:all')) {
      if (countClientRooms(socket) < MAX_CLIENT_ROOMS_PER_SOCKET) {
        socket.join('memos:all');
      } else {
        logger.debug({ socketId: socket.id }, 'Subscribe to memos:all dropped: socket at its room cap');
      }
    }

    const registry = PluginWebSocketRegistry.getInstance();
    for (const pluginId of registry.getAllPluginIds()) {
      const pluginPayload = payload[pluginId];
      if (pluginPayload !== undefined) {
        await this.subscribeToPluginRoom(socket, pluginId, pluginId, pluginPayload);
      }
    }
  }

  /**
   * Validate one plugin room subscription and hand it to the plugin's manager.
   *
   * Unknown plugins, malformed names, and requests over the room cap are
   * dropped at debug level: they are caused by client input, and logging them
   * higher would let any visitor fill the persisted log. A refusal over the
   * room cap is still reported to the client as `<plugin>:subscription-error`
   * so a well-behaved page can react.
   *
   * @param socket - The subscribing socket.
   * @param pluginId - Plugin the client named.
   * @param roomName - Plugin-local room the client named.
   * @param payload - Whatever options the client sent; the plugin validates it.
   * @returns Resolves when the plugin has handled or rejected the subscription.
   */
  private async subscribeToPluginRoom(
    socket: Socket,
    pluginId: string,
    roomName: string,
    payload: unknown
  ): Promise<void> {
    const manager = isValidRoomToken(pluginId) ? PluginWebSocketRegistry.getInstance().getManager(pluginId) : undefined;
    if (!manager) {
      logger.debug({ socketId: socket.id }, 'Subscribe ignored: unknown or malformed plugin id');
    } else if (!isValidRoomToken(roomName)) {
      logger.debug({ pluginId, socketId: socket.id }, 'Subscribe ignored: malformed room name');
    } else if (!socket.rooms.has(`plugin:${pluginId}:${roomName}`)
      && countClientRooms(socket) >= MAX_CLIENT_ROOMS_PER_SOCKET) {
      logger.debug({ pluginId, socketId: socket.id, roomName }, 'Subscribe refused: socket at its room cap');
      socket.emit(`${pluginId}:subscription-error`, {
        error: GENERIC_SUBSCRIPTION_ERROR_MESSAGE,
        pluginId,
        roomName
      });
    } else {
      try {
        await manager.handleSubscription(socket, roomName, payload);
      } catch {
        // The manager has already left the room, told the client, and logged it.
        logger.debug({ pluginId, socketId: socket.id, roomName }, 'Plugin rejected subscription');
      }
    }
  }

  /**
   * Handle an unsubscribe request from a client.
   *
   * Validated the same way as {@link handleSubscription} and charged against
   * the same per-socket budget, since each call can run a plugin handler.
   * Supports two formats:
   *
   * 1. Room-based: `socket.emit('unsubscribe', 'plugin-id', 'room-name', { options })`
   * 2. Legacy object: `socket.emit('unsubscribe', { 'plugin-id': { options } })`
   *
   * Plugin handler errors are logged by the manager and never prevent the
   * socket from leaving the room.
   *
   * @param socket - The Socket.IO socket requesting unsubscription.
   * @param pluginIdOrPayload - A plugin id (format 1) or the legacy object (format 2).
   * @param roomNameOrPayload - The room name in format 1.
   * @param optionalPayload - The plugin payload in format 1.
   * @returns Resolves when handling finishes; never rejects for client input.
   */
  private async handleUnsubscribe(
    socket: Socket,
    pluginIdOrPayload?: unknown,
    roomNameOrPayload?: unknown,
    optionalPayload?: unknown
  ): Promise<void> {
    const registry = PluginWebSocketRegistry.getInstance();
    if (!consumeSubscribeBudget(socket)) {
      logger.debug({ socketId: socket.id }, 'Unsubscribe dropped: socket over its event budget');
    } else if (typeof pluginIdOrPayload === 'string' && typeof roomNameOrPayload === 'string') {
      const manager = isValidRoomToken(pluginIdOrPayload) ? registry.getManager(pluginIdOrPayload) : undefined;
      if (manager && isValidRoomToken(roomNameOrPayload)) {
        await manager.handleUnsubscribe(socket, roomNameOrPayload, optionalPayload);
      } else {
        logger.debug({ socketId: socket.id }, 'Unsubscribe ignored: unknown plugin or malformed room name');
      }
    } else if (isPlainObject(pluginIdOrPayload)) {
      for (const pluginId of registry.getAllPluginIds()) {
        const pluginPayload = pluginIdOrPayload[pluginId];
        const manager = pluginPayload !== undefined ? registry.getManager(pluginId) : undefined;
        if (manager) {
          await manager.handleUnsubscribe(socket, pluginId, pluginPayload);
        }
      }
    } else {
      logger.debug({ socketId: socket.id }, 'Unsubscribe ignored: payload is not a plugin id or an object');
    }
  }

  public emit(event: any) {
    if (!this.io) {
      logger.warn('Attempted to emit without WebSocket initialization');
      return;
    }

    switch (event.event) {
      // `transaction:large`, `delegation:new`, `stake:new`, `comments:new` and
      // `chat:update` had cases here routing to client-joinable rooms, but
      // nothing on the server emitted them. They were removed with the legacy
      // subscriptions that fed those rooms; an emit of one now falls through to
      // `default` and is dropped, which is the safe direction.
      case 'block:new':
        this.io.emit(event.event, event.payload);
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
        // `audience: 'admin'`. It has no subscriber yet, and sending it to every
        // socket told anonymous visitors each published item's title and the
        // moment it went out. Routed to the admin group to match the sink's
        // declaration; a future public consumer should get its own event.
        this.io.to(`group:${ADMIN_GROUP_ID}`).emit(event.event, event.payload);
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

  /**
   * Disconnect a user's sockets so each one re-handshakes with its current identity.
   *
   * Identity rooms are chosen once, at the handshake. Without this, a socket
   * opened before sign-out or before an admin was demoted keeps its
   * `user:<id>` and `group:<id>` rooms, and the events sent to them, until it
   * reconnects on its own — which a hostile client never has to do. The
   * official client reconnects immediately after a server-side disconnect, so
   * a legitimate user sees at most a brief reconnect.
   *
   * @param userId - Better Auth user id whose sockets should be dropped.
   * @param sessionId - When given, only sockets whose handshake session has
   *   this id are dropped, so signing out on one device leaves the user's
   *   other signed-in devices connected.
   * @returns Resolves once the matching sockets have been disconnected.
   */
  public async disconnectUser(userId: string, sessionId?: string): Promise<void> {
    if (this.io && userId) {
      const sockets = await this.io.in(`user:${userId}`).fetchSockets();
      for (const socket of sockets) {
        const socketSessionId = (socket.data as { authSession?: { session?: { id?: string } } | null } | undefined)
          ?.authSession?.session?.id;
        if (!sessionId || socketSessionId === sessionId) {
          socket.disconnect(true);
        }
      }
      logger.debug({ userId, sessionScoped: Boolean(sessionId), candidates: sockets.length }, 'Disconnected user sockets after identity change');
    }
  }

}
