import type { IWebSocketService } from '@tronrelic/types';
import type { Server } from 'http';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import type { TronRelicSocketEvent, SocketSubscriptions } from '@tronrelic/shared';
import { logger } from '../lib/logger.js';
import { PluginWebSocketRegistry } from './plugin-websocket-registry.js';

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
        origin: '*'
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
    logger.info({ socketId: socket.id }, 'Client connected');

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

    // Handle user identity subscriptions
    if (payload.user?.userId) {
      const userId = payload.user.userId.trim();
      if (userId) {
        const userRoom = `user:${userId}`;
        socket.join(userRoom);
        logger.debug({ socketId: socket.id, userRoom }, 'User identity subscription registered');
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
