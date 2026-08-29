'use client';

import { useEffect, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import { getSocket, disconnectSocket, WEBSOCKET_DEFER_TIMEOUT_MS } from '../../lib/socketClient';
import { useSession } from '../../modules/user/lib/auth-client';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { prependMemo } from '../../store/slices/memoSlice';
import { blockReceived } from '../../features/blockchain/slice';
import { refetchMenuTree, namespaceConfigSet } from '../../modules/menu/slice';
import type { IMenuNamespaceConfig } from '../../modules/menu/types';
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
  MenuUpdatePayload,
  MenuNamespaceConfigUpdatePayload,
  SocketSubscriptions
} from '@/shared';

/** User interaction events that trigger immediate WebSocket connection */
const INTERACTION_EVENTS = ['click', 'scroll', 'touchstart', 'keydown', 'mousemove'] as const;

/**
 * Target spacing between block releases, matching TRON's own block time.
 *
 * The backend paces its broadcasts to this same cadence, but it cannot make the
 * feed perfectly even on its own, because TRON does not produce blocks on an
 * exact metronome — a super representative that misses its slot leaves a real
 * six-second hole no amount of backend pacing can fill. Holding arrivals here
 * and releasing them on a fixed clock is the only thing that can smooth that
 * out, in the same way a video player buffers a few frames rather than drawing
 * each one the instant it arrives.
 */
const BLOCK_RELEASE_INTERVAL_MS = 3_000;

/**
 * Faster spacing used while blocks are stacking up.
 *
 * Without it the buffer can only ever fall further behind: a burst arriving
 * during a reconnect would be released one every three seconds forever, adding
 * permanent delay for no benefit. Draining slightly faster than blocks arrive
 * works the backlog off and returns to the normal cadence.
 */
const BLOCK_RELEASE_CATCHUP_INTERVAL_MS = 2_000;

/** Queue depth at which the buffer switches to the catch-up interval. */
const BLOCK_BUFFER_CATCHUP_DEPTH = 3;

/**
 * Depth beyond which blocks are released with no wait at all.
 *
 * A hard ceiling matters because the buffer is memory the page holds: a tab
 * left open through a long backend catch-up run could otherwise accumulate
 * hundreds of blocks and show the user minutes-old data as if it were live.
 */
const BLOCK_BUFFER_MAX_DEPTH = 12;

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
  const connectionInitiatedRef = useRef(false);
  const countdownIntervalRef = useRef<number | null>(null);

  // Playout buffer for incoming blocks. Blocks land in `blockBufferRef` and are
  // released to Redux on a clock rather than on arrival, so the ticker advances
  // evenly even when the blocks themselves arrive unevenly. The timer handle
  // and the last release time are refs rather than state because changing them
  // must not re-render — this component renders nothing.
  const blockBufferRef = useRef<BlockNotificationPayload['payload'][]>([]);
  const blockReleaseTimerRef = useRef<number | null>(null);
  const lastBlockReleaseAtRef = useRef(0);
  // False until the first block has been released. It is what makes the buffer
  // hold one interval of lead before playback starts; without that lead there
  // is never anything in hand to spend on a skipped slot.
  const blockBufferPrimedRef = useRef(false);

  const desired = useAppSelector(state => state.realtime.desired);
  const pending = useAppSelector(state => state.realtime.pending);
  const connectionStatus = useAppSelector(state => state.realtime.connection.status);
  const commentThreads = useAppSelector(state => state.realtime.subscriptions.commentThreads);

  // Better Auth identity, read straight from BA's client store. SocketBridge
  // mounts as a sibling above SessionProvider, so it cannot use the
  // SessionProvider context — but `useSession` is BA's own reactive hook and
  // works anywhere under the providers.
  const { data: sessionData } = useSession();

  // The socket's identity rooms are `user:${id}` plus one `group:${id}` per
  // group, so both halves of the identity have to be watched — a change in
  // either leaves the rooms stale. Groups are easy to overlook and their
  // staleness is the quieter failure: events addressed to `group:admin` (the
  // /system dashboards' refetch nudges) simply never reach a socket that
  // handshook before the account was promoted, and nothing surfaces an error —
  // the page renders, it just silently stops updating.
  //
  // `groups` is a Better Auth additional field, so it rides along on the
  // session's user record; it is read defensively because BA's inferred client
  // user type does not surface custom fields. Sorted before joining so a
  // reordering on the server side does not read as a membership change.
  const sessionUserId = sessionData?.user?.id ?? null;
  const sessionGroups = (sessionData?.user as { groups?: string[] } | undefined)?.groups;
  const identityKey = sessionUserId === null
    ? null
    : `${sessionUserId}|${[...(sessionGroups ?? [])].sort().join(',')}`;
  const establishedIdentityRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    desiredRef.current = desired ?? null;
  }, [desired]);

  useEffect(() => {
    commentThreadsRef.current = commentThreads;
  }, [commentThreads]);

  // Re-handshake the socket whenever the authenticated identity changes after
  // the initial load. A Socket.IO handshake captures its auth cookie once, at
  // connect time, and never refreshes it — so a long-lived socket keeps the
  // identity rooms (`user:${id}`/`group:${id}`) it joined when it first
  // connected. Without this, after sign-out a tab would stay in its old user
  // room and keep receiving that account's targeted/admin notifications; after
  // sign-in it would never join the new room; and after a group promotion it
  // would never join `group:admin`, so every admin-scoped refetch nudge would
  // pass it by. Forcing disconnect+connect makes the server treat the
  // reconnect as a fresh connection: the old socket leaves its rooms on
  // disconnect, and the new handshake re-resolves identity rooms from the
  // current cookie. Handlers stay attached to the same client instance and
  // `handleConnect` re-subscribes from `desiredRef`, so app subscriptions
  // survive (a full effect teardown would clear them). The first observed
  // identity is recorded without reconnecting — the initial handshake already
  // carries the right cookie — and a socket that has not connected yet is left
  // alone, since its first handshake will use the current cookie.
  //
  // This closes the client-observable half of room staleness. A membership
  // change the client's session has not picked up yet, or a handshake whose
  // server-side session resolution failed, are not visible here; the server
  // retries a failed resolution during the handshake itself.
  useEffect(() => {
    if (establishedIdentityRef.current === undefined) {
      establishedIdentityRef.current = identityKey;
      return;
    }
    if (establishedIdentityRef.current === identityKey) {
      return;
    }
    establishedIdentityRef.current = identityKey;

    const socket = socketRef.current;
    if (socket && socket.connected) {
      socket.disconnect();
      socket.connect();
    }
  }, [identityKey]);

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

    const clearBlockReleaseTimer = () => {
      if (blockReleaseTimerRef.current !== null) {
        window.clearTimeout(blockReleaseTimerRef.current);
        blockReleaseTimerRef.current = null;
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

    /**
     * Release one buffered block and line up the next release.
     *
     * Self-scheduling rather than a fixed `setInterval` for two reasons. An
     * interval that fires while the buffer is empty wastes its slot, so the
     * next block would wait a further full interval and the buffer would add
     * permanent latency it never gives back. And an interval cannot vary its
     * spacing, which is what lets a backlog drain faster than it arrives.
     */
    const releaseBufferedBlock = () => {
      blockReleaseTimerRef.current = null;

      const next = blockBufferRef.current.shift();
      if (next) {
        lastBlockReleaseAtRef.current = Date.now();
        blockBufferPrimedRef.current = true;
        dispatch(blockReceived(next));
      }

      scheduleBlockRelease();
    };

    /**
     * Schedule the next release, spacing it by how much work is waiting.
     *
     * Timing is measured from the previous release rather than from now, so a
     * block that arrives after a quiet stretch goes out immediately instead of
     * sitting through a wait the feed has already served.
     */
    const scheduleBlockRelease = () => {
      const depth = blockBufferRef.current.length;

      // Nothing waiting: stand down and let the next arrival restart the clock,
      // rather than burning slots against an empty buffer.
      if (depth === 0 || blockReleaseTimerRef.current !== null) {
        return;
      }

      let interval = BLOCK_RELEASE_INTERVAL_MS;
      if (depth >= BLOCK_BUFFER_MAX_DEPTH) {
        interval = 0;
      } else if (depth >= BLOCK_BUFFER_CATCHUP_DEPTH) {
        interval = BLOCK_RELEASE_CATCHUP_INTERVAL_MS;
      }

      const sinceLast = Date.now() - lastBlockReleaseAtRef.current;
      let wait = Math.max(0, interval - sinceLast);

      // Hold the very first block for a full interval so playback starts one
      // interval behind the feed. Without this the buffer keeps nothing: every
      // arrival finds the previous release already an interval old, waits zero
      // and goes straight out, so a skipped TRON slot still shows as a six
      // second hole. Reusing `interval` here means a burst that has already
      // reached the catch-up or maximum depth is not held, since a backlog
      // supplies the depth this hold exists to create.
      if (!blockBufferPrimedRef.current) {
        wait = Math.max(wait, interval);
      }

      blockReleaseTimerRef.current = window.setTimeout(releaseBufferedBlock, wait);
    };

    const handleBlockUpdate = (payload: BlockNotificationPayload['payload']) => {
      blockBufferRef.current.push(payload);
      scheduleBlockRelease();
    };

    const handleMenuUpdate = (payload: MenuUpdatePayload['payload']) => {
      // Per-user gating means the server can't broadcast a single tree
      // shape. The signal carries `{ namespace, nodeId, event, timestamp }`;
      // each client refetches `GET /api/menu` with its own cookie to get
      // its filtered view.
      dispatch(refetchMenuTree({ namespace: payload.namespace, timestamp: payload.timestamp }));
    };

    const handleMenuNamespaceConfigUpdate = (payload: MenuNamespaceConfigUpdatePayload['payload']) => {
      // Namespace config has no per-user variance, so the server emits the
      // full normalized config inline — no refetch needed. The wire type
      // is `Record<string, unknown>` to keep the shared socket types
      // decoupled from the menu types, so this is the validation
      // boundary: drop the event if the payload is not an object or its
      // namespace disagrees with the envelope. Nested fields (icons,
      // styling, layout, overflow) are intentionally not validated here
      // — `useMenuConfig` and `MenuNavClient` already degrade gracefully
      // with `?? defaults`, so a partial shape is harmless. A flat-out
      // bogus payload is what would poison the store.
      const raw = payload.config;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        console.warn('Dropped menu:namespace-config:update with non-object config', payload);
        return;
      }
      const configNamespace = (raw as { namespace?: unknown }).namespace;
      if (typeof configNamespace !== 'string' || configNamespace !== payload.namespace) {
        console.warn(
          `Dropped menu:namespace-config:update — namespace mismatch (envelope=${payload.namespace}, config=${String(configNamespace)})`
        );
        return;
      }
      dispatch(namespaceConfigSet({
        namespace: payload.namespace,
        config: raw as unknown as IMenuNamespaceConfig
      }));
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
    socket.on('menu:update', handleMenuUpdate);
    socket.on('menu:namespace-config:update', handleMenuNamespaceConfigUpdate);

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
      clearBlockReleaseTimer();
      clearInteractionListeners();

      // Drop whatever has not been released. These blocks describe a feed the
      // unmounted page was showing; a remount fetches fresh state on the
      // server, so replaying stale ones would only fight that.
      blockBufferRef.current = [];
      blockBufferPrimedRef.current = false;

      socket.off('memo:new', handleMemoUpdate);
      socket.off('block:new', handleBlockUpdate);
      socket.off('menu:update', handleMenuUpdate);
      socket.off('menu:namespace-config:update', handleMenuNamespaceConfigUpdate);
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
