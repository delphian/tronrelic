'use client';

import { io, type Socket } from 'socket.io-client';
import { config } from './config';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
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

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
