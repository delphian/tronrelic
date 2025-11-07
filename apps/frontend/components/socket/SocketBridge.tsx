'use client';

import { useEffect, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import { getSocket, disconnectSocket } from '../../lib/socketClient';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { prependMemo } from '../../store/slices/memoSlice';
import { blockReceived } from '../../features/blockchain/slice';
import {
  connectionConnecting,
  connectionEstablished,
  connectionDisconnected,
  connectionError,
  reconnectAttempted,
  heartbeatReceived,
  subscriptionsActivated,
  clearSubscriptions
} from '../../features/realtime/slice';
import type {
  BlockNotificationPayload,
  MemoUpdatePayload,
  SocketSubscriptions
} from '@tronrelic/shared';

export function SocketBridge() {
  const dispatch = useAppDispatch();
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const manualDisconnectRef = useRef(false);
  const hydratedRef = useRef(false);
  const socketRef = useRef<Socket | null>(null);
  const desiredRef = useRef<SocketSubscriptions | null>(null);
  const commentThreadsRef = useRef<string[]>([]);
  const commentThreadSetRef = useRef<Set<string>>(new Set());

  const desired = useAppSelector(state => state.realtime.desired);
  const pending = useAppSelector(state => state.realtime.pending);
  const connectionStatus = useAppSelector(state => state.realtime.connection.status);
  const commentThreads = useAppSelector(state => state.realtime.subscriptions.commentThreads);

  useEffect(() => {
    desiredRef.current = desired ?? null;
  }, [desired]);

  useEffect(() => {
    commentThreadsRef.current = commentThreads;
  }, [commentThreads]);

  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;
    manualDisconnectRef.current = false;
    dispatch(connectionConnecting());

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const resetReconnectState = () => {
      reconnectAttemptRef.current = 0;
      clearReconnectTimer();
    };

    const scheduleReconnect = (immediate = false) => {
      if (manualDisconnectRef.current || socket.connected) {
        return;
      }

      const nextAttempt = immediate
        ? Math.max(reconnectAttemptRef.current, 1)
        : reconnectAttemptRef.current + 1;

      reconnectAttemptRef.current = nextAttempt;

      const baseDelay = 1_200;
      const delay = immediate ? 0 : Math.min(baseDelay * 2 ** (nextAttempt - 1), 15_000);

      clearReconnectTimer();

      reconnectTimerRef.current = window.setTimeout(() => {
        if (!manualDisconnectRef.current) {
          socket.connect();
        }
      }, delay);

      dispatch(reconnectAttempted({ attempt: nextAttempt, timestamp: new Date().toISOString() }));
    };

    const handleConnect = () => {
      resetReconnectState();
      hydratedRef.current = true;
      dispatch(connectionEstablished({ socketId: socket.id, timestamp: new Date().toISOString() }));

      const currentDesired = desiredRef.current;
      if (currentDesired) {
        socket.emit('subscribe', currentDesired);
        dispatch(subscriptionsActivated(currentDesired));
      }

      if (commentThreadsRef.current.length) {
        commentThreadsRef.current.forEach(threadId => {
          socket.emit('subscribe', { comments: { resourceId: threadId } });
        });
        commentThreadSetRef.current = new Set(commentThreadsRef.current);
      }
    };

    const handleDisconnect = (reason: Socket.DisconnectReason) => {
      dispatch(connectionDisconnected({ reason, timestamp: new Date().toISOString() }));
      commentThreadSetRef.current.clear();
      if (!manualDisconnectRef.current && reason !== 'io client disconnect') {
        scheduleReconnect();
      }
    };

    const handleConnectError = (error: Error) => {
      dispatch(connectionError({ error: error.message, timestamp: new Date().toISOString() }));
      if (!manualDisconnectRef.current) {
        scheduleReconnect();
      }
    };

    const handlePong = (latency?: number) => {
      dispatch(heartbeatReceived({ latencyMs: typeof latency === 'number' ? latency : null, timestamp: new Date().toISOString() }));
    };

    const handleMemoUpdate = (payload: MemoUpdatePayload['payload']) => {
      dispatch(prependMemo(payload));
    };

    const handleBlockUpdate = (payload: BlockNotificationPayload['payload']) => {
      dispatch(blockReceived(payload));
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && !socket.connected && !manualDisconnectRef.current) {
        scheduleReconnect(true);
      }
    };

    const handleOnline = () => {
      if (!socket.connected && !manualDisconnectRef.current) {
        scheduleReconnect(true);
      }
    };

    const handleOffline = () => {
      dispatch(connectionDisconnected({ reason: 'offline', timestamp: new Date().toISOString() }));
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);
    socket.on('pong', handlePong);
    socket.on('memo:new', handleMemoUpdate);
    socket.on('block:new', handleBlockUpdate);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibility);

    socket.connect();

    const trackedCommentThreads = commentThreadSetRef.current;

    return () => {
      manualDisconnectRef.current = true;
      clearReconnectTimer();
      socket.off('memo:new', handleMemoUpdate);
      socket.off('block:new', handleBlockUpdate);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);
      socket.off('pong', handlePong);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibility);

      dispatch(connectionDisconnected({ reason: 'component-unmounted', timestamp: new Date().toISOString() }));
      dispatch(clearSubscriptions());
      trackedCommentThreads.clear();
      commentThreadSetRef.current = trackedCommentThreads;
      socketRef.current = null;
      disconnectSocket();
    };
  }, [dispatch]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!pending || !desired || !socket || !socket.connected) {
      return;
    }
    socket.emit('subscribe', desired);
    dispatch(subscriptionsActivated(desired));
  }, [desired, pending, connectionStatus, dispatch]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) {
      return;
    }

    const previous = commentThreadSetRef.current;
    const next = new Set(commentThreads);

    commentThreads.forEach(threadId => {
      if (!previous.has(threadId)) {
        socket.emit('subscribe', { comments: { resourceId: threadId } });
      }
    });

    commentThreadSetRef.current = next;
  }, [commentThreads, connectionStatus]);

  return null;
}
