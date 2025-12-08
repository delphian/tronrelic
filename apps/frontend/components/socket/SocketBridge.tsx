'use client';

import { useEffect, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import { getSocket, disconnectSocket, WEBSOCKET_DEFER_TIMEOUT_MS } from '../../lib/socketClient';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { prependMemo } from '../../store/slices/memoSlice';
import { blockReceived } from '../../features/blockchain/slice';
import { setUserData, selectUserId } from '../../modules/user';
import {
  connectionDeferred,
  deferredCountdownTick,
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
import type { IUserData } from '../../modules/user';

/** User interaction events that trigger immediate WebSocket connection */
const INTERACTION_EVENTS = ['click', 'scroll', 'touchstart', 'keydown', 'mousemove'] as const;

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
  const userIdRef = useRef<string | null>(null);
  const userSubscribedRef = useRef(false);
  const connectionInitiatedRef = useRef(false);
  const countdownIntervalRef = useRef<number | null>(null);

  const desired = useAppSelector(state => state.realtime.desired);
  const pending = useAppSelector(state => state.realtime.pending);
  const connectionStatus = useAppSelector(state => state.realtime.connection.status);
  const commentThreads = useAppSelector(state => state.realtime.subscriptions.commentThreads);
  const userId = useAppSelector(selectUserId);

  useEffect(() => {
    desiredRef.current = desired ?? null;
  }, [desired]);

  useEffect(() => {
    commentThreadsRef.current = commentThreads;
  }, [commentThreads]);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;
    manualDisconnectRef.current = false;
    connectionInitiatedRef.current = false;

    // Calculate initial countdown in seconds
    const initialSeconds = Math.ceil(WEBSOCKET_DEFER_TIMEOUT_MS / 1000);
    let secondsRemaining = initialSeconds;

    // Start in deferred state with countdown
    dispatch(connectionDeferred({ secondsRemaining: initialSeconds }));

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const clearCountdownInterval = () => {
      if (countdownIntervalRef.current !== null) {
        window.clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    };

    const clearInteractionListeners = () => {
      INTERACTION_EVENTS.forEach(event => {
        document.removeEventListener(event, handleInteraction);
      });
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

    /**
     * Initiates WebSocket connection.
     * Called on user interaction or when countdown reaches zero.
     */
    const initiateConnection = () => {
      if (connectionInitiatedRef.current || manualDisconnectRef.current) {
        return;
      }
      connectionInitiatedRef.current = true;

      // Clean up deferred state listeners
      clearCountdownInterval();
      clearInteractionListeners();

      // Transition to connecting state and connect
      dispatch(connectionConnecting());
      socket.connect();
    };

    /**
     * Handles user interaction - triggers immediate connection.
     */
    const handleInteraction = () => {
      initiateConnection();
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

    const handleUserUpdate = (payload: IUserData) => {
      dispatch(setUserData(payload));
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && !socket.connected && !manualDisconnectRef.current) {
        // If connection was initiated, try to reconnect
        if (connectionInitiatedRef.current) {
          scheduleReconnect(true);
        }
      }
    };

    const handleOnline = () => {
      if (!socket.connected && !manualDisconnectRef.current && connectionInitiatedRef.current) {
        scheduleReconnect(true);
      }
    };

    const handleOffline = () => {
      dispatch(connectionDisconnected({ reason: 'offline', timestamp: new Date().toISOString() }));
    };

    // Set up socket event handlers
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);
    socket.on('pong', handlePong);
    socket.on('memo:new', handleMemoUpdate);
    socket.on('block:new', handleBlockUpdate);
    socket.on('user:update', handleUserUpdate);

    // Set up browser event handlers
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibility);

    // Set up interaction listeners for immediate connection
    INTERACTION_EVENTS.forEach(event => {
      document.addEventListener(event, handleInteraction, { once: true, passive: true });
    });

    // Set up countdown interval - tick every second
    countdownIntervalRef.current = window.setInterval(() => {
      secondsRemaining -= 1;

      if (secondsRemaining <= 0) {
        // Countdown complete - initiate connection
        initiateConnection();
      } else {
        // Update countdown display
        dispatch(deferredCountdownTick({ secondsRemaining }));
      }
    }, 1000);

    const trackedCommentThreads = commentThreadSetRef.current;

    return () => {
      manualDisconnectRef.current = true;
      clearReconnectTimer();
      clearCountdownInterval();
      clearInteractionListeners();

      socket.off('memo:new', handleMemoUpdate);
      socket.off('block:new', handleBlockUpdate);
      socket.off('user:update', handleUserUpdate);
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

  // Subscribe to user identity events when userId is available
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !socket.connected || !userId) {
      return;
    }

    // Only subscribe once per user
    if (userSubscribedRef.current && userIdRef.current === userId) {
      return;
    }

    socket.emit('subscribe', { user: { userId } });
    userSubscribedRef.current = true;
  }, [userId, connectionStatus]);

  return null;
}
