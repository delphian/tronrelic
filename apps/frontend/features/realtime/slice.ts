import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { NotificationChannel, SocketSubscriptions } from '@tronrelic/shared';

const MAX_LATENCY_SAMPLES = 20;

export interface SubscriptionState {
  marketsAll: boolean;
  marketIds: string[];
  transactionsAll: boolean;
  transactionMinAmount: number | null;
  transactionAddresses: string[];
  memosAll: boolean;
  commentThreads: string[];
  chat: boolean;
  notificationsWallets: string[];
}

export interface ConnectionState {
  status: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
  socketId?: string;
  reconnectAttempts: number;
  lastConnectedAt?: string;
  lastDisconnectedAt?: string;
  lastAttemptAt?: string;
  lastHeartbeatAt?: string;
  lastLatencyMs?: number | null;
  averageLatencyMs?: number | null;
  latencySamples: number[];
  error?: string | null;
}

export interface RealtimeState {
  connection: ConnectionState;
  subscriptions: SubscriptionState;
  desired: SocketSubscriptions | null;
  pending: boolean;
  registry: Record<string, SocketSubscriptions>;
}

const createEmptySubscriptions = (): SubscriptionState => ({
  marketsAll: false,
  marketIds: [],
  transactionsAll: false,
  transactionMinAmount: null,
  transactionAddresses: [],
  memosAll: false,
  commentThreads: [],
  chat: false,
  notificationsWallets: []
});

const createInitialState = (): RealtimeState => ({
  connection: {
    status: 'idle',
    reconnectAttempts: 0,
    latencySamples: [],
    error: null,
    lastLatencyMs: null,
    averageLatencyMs: null
  },
  subscriptions: createEmptySubscriptions(),
  desired: null,
  pending: false,
  registry: {}
});

const initialState = createInitialState();

function uniqueSorted<T extends string>(values: T[]): T[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b)) as T[];
}

function mergeSubscriptions(registry: Record<string, SocketSubscriptions>): SocketSubscriptions | null {
  const entries = Object.values(registry);
  if (!entries.length) {
    return null;
  }

  const result: SocketSubscriptions = {};
  let hasAny = false;

  for (const entry of entries) {
    if (entry.markets) {
      result.markets = result.markets ?? {};
      if (entry.markets.all) {
        result.markets.all = true;
        hasAny = true;
      }
      if (entry.markets.markets?.length) {
        const merged = uniqueSorted([...(result.markets.markets ?? []), ...entry.markets.markets]);
        if (merged.length) {
          result.markets.markets = merged;
          hasAny = true;
        }
      }
    }

    if (entry.transactions) {
      result.transactions = result.transactions ?? {};
      hasAny = true;
      if (typeof entry.transactions.minAmount === 'number') {
        const current = result.transactions.minAmount;
        result.transactions.minAmount = typeof current === 'number'
          ? Math.min(current, entry.transactions.minAmount)
          : entry.transactions.minAmount;
      }
      if (entry.transactions.addresses?.length) {
        const merged = uniqueSorted([...(result.transactions.addresses ?? []), ...entry.transactions.addresses]);
        if (merged.length) {
          result.transactions.addresses = merged;
        }
      }
    }

    if (entry.memos?.all) {
      result.memos = { all: true };
      hasAny = true;
    }

    if (entry.chat) {
      result.chat = true;
      hasAny = true;
    }

    if (entry.notifications?.wallet) {
      result.notifications = result.notifications ?? { wallet: entry.notifications.wallet };
      if (!result.notifications.wallet) {
        result.notifications.wallet = entry.notifications.wallet;
      }
      if (entry.notifications.channels?.length) {
        const merged = uniqueSorted([...(result.notifications.channels ?? []), ...entry.notifications.channels]);
        if (merged.length) {
          result.notifications.channels = merged;
        }
      }
      hasAny = true;
    }
  }

  return hasAny ? result : null;
}

function mapSubscriptions(subscriptions: SocketSubscriptions): SubscriptionState {
  return {
    marketsAll: Boolean(subscriptions.markets?.all),
    marketIds: subscriptions.markets?.markets ?? [],
    transactionsAll: Boolean(subscriptions.transactions),
    transactionMinAmount: subscriptions.transactions?.minAmount ?? null,
    transactionAddresses: subscriptions.transactions?.addresses ?? [],
    memosAll: Boolean(subscriptions.memos?.all),
    commentThreads: [],
    chat: Boolean(subscriptions.chat),
    notificationsWallets: subscriptions.notifications?.wallet ? [subscriptions.notifications.wallet] : []
  };
}

const realtimeSlice = createSlice({
  name: 'realtime',
  initialState,
  reducers: {
    connectionConnecting(state) {
      state.connection.status = 'connecting';
      state.connection.lastAttemptAt = new Date().toISOString();
      state.connection.error = null;
    },
    connectionEstablished(state, action: PayloadAction<{ socketId?: string; timestamp?: string } | undefined>) {
      const payload = action.payload;
      state.connection.status = 'connected';
      state.connection.socketId = payload?.socketId;
      state.connection.lastConnectedAt = payload?.timestamp ?? new Date().toISOString();
      state.connection.reconnectAttempts = 0;
      state.connection.error = null;
    },
    connectionDisconnected(state, action: PayloadAction<{ reason?: string; timestamp?: string } | undefined>) {
      const payload = action.payload;
      state.connection.status = 'disconnected';
      state.connection.lastDisconnectedAt = payload?.timestamp ?? new Date().toISOString();
      if (payload?.reason) {
        state.connection.error = payload.reason;
      }
      state.connection.socketId = undefined;
    },
    reconnectAttempted(state, action: PayloadAction<{ attempt: number; timestamp?: string }>) {
      state.connection.status = 'reconnecting';
      state.connection.reconnectAttempts = action.payload.attempt;
      state.connection.lastAttemptAt = action.payload.timestamp ?? new Date().toISOString();
    },
    connectionError(state, action: PayloadAction<{ error: string; timestamp?: string }>) {
      state.connection.error = action.payload.error;
      state.connection.lastAttemptAt = action.payload.timestamp ?? new Date().toISOString();
    },
    heartbeatReceived(state, action: PayloadAction<{ latencyMs?: number | null; timestamp?: string }>) {
      state.connection.lastHeartbeatAt = action.payload.timestamp ?? new Date().toISOString();
      const latency = typeof action.payload.latencyMs === 'number' ? action.payload.latencyMs : null;
      if (latency !== null && Number.isFinite(latency)) {
        state.connection.lastLatencyMs = latency;
        state.connection.latencySamples.push(latency);
        if (state.connection.latencySamples.length > MAX_LATENCY_SAMPLES) {
          state.connection.latencySamples.shift();
        }
        const total = state.connection.latencySamples.reduce((sum, value) => sum + value, 0);
        state.connection.averageLatencyMs = Number((total / state.connection.latencySamples.length).toFixed(2));
      }
    },
    desiredSubscriptionsUpdated(state, action: PayloadAction<SocketSubscriptions>) {
      state.desired = action.payload;
      state.pending = true;
    },
    subscriptionsActivated(state, action: PayloadAction<SocketSubscriptions>) {
      state.subscriptions = {
        ...mapSubscriptions(action.payload),
        commentThreads: uniqueSorted(
          Object.values(state.registry)
            .map(entry => entry.comments?.resourceId)
            .filter((value): value is string => Boolean(value))
        )
      };
      state.desired = action.payload;
      state.pending = false;
    },
    clearSubscriptions(state) {
      state.subscriptions = createEmptySubscriptions();
      state.desired = null;
      state.pending = false;
      state.registry = {};
    },
    registerSubscription(state, action: PayloadAction<{ id: string; payload: SocketSubscriptions }>) {
      const { id, payload } = action.payload;
      state.registry[id] = payload;
      const merged = mergeSubscriptions(state.registry);
      state.desired = merged;
      state.pending = Boolean(merged);
      state.subscriptions = {
        ...(merged ? mapSubscriptions(merged) : createEmptySubscriptions()),
        commentThreads: uniqueSorted(
          Object.values(state.registry)
            .map(entry => entry.comments?.resourceId)
            .filter((value): value is string => Boolean(value))
        )
      };
      if (!merged) {
        state.pending = false;
      }
    },
    unregisterSubscription(state, action: PayloadAction<{ id: string }>) {
      delete state.registry[action.payload.id];
      const merged = mergeSubscriptions(state.registry);
      state.desired = merged;
      state.pending = Boolean(merged);
      state.subscriptions = {
        ...(merged ? mapSubscriptions(merged) : createEmptySubscriptions()),
        commentThreads: uniqueSorted(
          Object.values(state.registry)
            .map(entry => entry.comments?.resourceId)
            .filter((value): value is string => Boolean(value))
        )
      };
      if (!merged) {
        state.pending = false;
      }
    },
    resetRealtime: () => createInitialState()
  }
});

export const {
  connectionConnecting,
  connectionEstablished,
  connectionDisconnected,
  reconnectAttempted,
  connectionError,
  heartbeatReceived,
  desiredSubscriptionsUpdated,
  subscriptionsActivated,
  clearSubscriptions,
  registerSubscription,
  unregisterSubscription,
  resetRealtime
} = realtimeSlice.actions;

export default realtimeSlice.reducer;
