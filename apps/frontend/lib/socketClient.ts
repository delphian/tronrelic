'use client';

import { io, type Socket } from 'socket.io-client';
import { getRuntimeConfig } from './runtimeConfig';

let socket: Socket | null = null;

/**
 * Gets or creates the Socket.IO client instance.
 *
 * Why runtime config:
 * Uses getRuntimeConfig() to read WebSocket URL from window.__RUNTIME_CONFIG__
 * (injected by SSR). This eliminates the need for build-time NEXT_PUBLIC_SOCKET_URL,
 * allowing Docker images to work on any domain without rebuilding.
 *
 * Singleton pattern:
 * Creates socket once and reuses it for application lifetime. SocketBridge component
 * manages connection lifecycle (connect/disconnect) via this shared instance.
 *
 * @returns Shared Socket.IO client instance
 */
export function getSocket(): Socket {
  if (!socket) {
    const config = getRuntimeConfig();
    socket = io(config.socketUrl, {
      transports: ['websocket'],
      autoConnect: false,
      reconnection: false,
      timeout: 10_000,
      withCredentials: true
    });
  }
  return socket;
}

/**
 * Disconnects and destroys the Socket.IO client instance.
 *
 * Called by SocketBridge during component cleanup.
 * Next getSocket() call will create a new instance.
 */
export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
