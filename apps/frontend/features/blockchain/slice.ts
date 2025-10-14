import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { BlockNotificationPayload } from '@tronrelic/shared';

const MAX_HISTORY = 120;
const METRIC_WINDOW = 12;

export interface BlockStatSnapshot {
  transactions: number;
  transfers: number;
  contractCalls: number;
  delegations: number;
  stakes: number;
  tokenCreations: number;
  internalTransactions: number;
  totalEnergyUsed: number;
  totalEnergyCost: number;
  totalBandwidthUsed: number;
}

export interface BlockSummary {
  blockNumber: number;
  timestamp: string;
  transactionCount: number;
  stats: BlockStatSnapshot;
}

export interface BlockchainMetrics {
  transactionsPerSecond: number | null;
  averageBlockTimeSeconds: number | null;
  averageEnergyPerBlock: number | null;
  averageBandwidthPerBlock: number | null;
  networkLagSeconds: number | null;
}

export interface BlockchainState {
  latestBlock: BlockSummary | null;
  history: BlockSummary[];
  metrics: BlockchainMetrics;
  status: 'idle' | 'loading' | 'ready' | 'error';
  lastUpdated?: string;
  error?: string | null;
}

const createInitialState = (): BlockchainState => ({
  latestBlock: null,
  history: [],
  metrics: {
    transactionsPerSecond: null,
    averageBlockTimeSeconds: null,
    averageEnergyPerBlock: null,
    averageBandwidthPerBlock: null,
    networkLagSeconds: null
  },
  status: 'idle',
  error: null,
  lastUpdated: undefined
});

const initialState = createInitialState();

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeStats(raw: Record<string, unknown> | undefined): BlockStatSnapshot {
  return {
    transactions: toNumber(raw?.transactions ?? raw?.transactionCount),
    transfers: toNumber(raw?.transfers),
    contractCalls: toNumber(raw?.contractCalls),
    delegations: toNumber(raw?.delegations),
    stakes: toNumber(raw?.stakes),
    tokenCreations: toNumber(raw?.tokenCreations),
    internalTransactions: toNumber(raw?.internalTransactions),
    totalEnergyUsed: toNumber(raw?.totalEnergyUsed),
    totalEnergyCost: toNumber(raw?.totalEnergyCost),
    totalBandwidthUsed: toNumber(raw?.totalBandwidthUsed)
  };
}

function computeMetrics(history: BlockSummary[]): Omit<BlockchainMetrics, 'networkLagSeconds'> {
  if (history.length < 2) {
    const latest = history[0];
    return {
      transactionsPerSecond: null,
      averageBlockTimeSeconds: null,
      averageEnergyPerBlock: latest ? latest.stats.totalEnergyUsed : null,
      averageBandwidthPerBlock: latest ? latest.stats.totalBandwidthUsed : null
    };
  }

  const sample = history.slice(0, METRIC_WINDOW);
  const firstTimestamp = Date.parse(sample[0].timestamp);
  const lastTimestamp = Date.parse(sample[sample.length - 1].timestamp);
  const durationMs = Math.abs(firstTimestamp - lastTimestamp);
  const durationSeconds = durationMs > 0 ? durationMs / 1000 : 0;

  const totalTransactions = sample.reduce((acc, block) => acc + block.transactionCount, 0);
  const totalEnergy = sample.reduce((acc, block) => acc + block.stats.totalEnergyUsed, 0);
  const totalBandwidth = sample.reduce((acc, block) => acc + block.stats.totalBandwidthUsed, 0);

  const averageBlockTimeSeconds = sample.length > 1 && durationSeconds > 0
    ? durationSeconds / (sample.length - 1)
    : null;

  const transactionsPerSecond = durationSeconds > 0
    ? totalTransactions / durationSeconds
    : null;

  const averageEnergyPerBlock = sample.length > 0 ? totalEnergy / sample.length : null;
  const averageBandwidthPerBlock = sample.length > 0 ? totalBandwidth / sample.length : null;

  return {
    transactionsPerSecond,
    averageBlockTimeSeconds,
    averageEnergyPerBlock,
    averageBandwidthPerBlock
  };
}

function computeNetworkLagSeconds(timestamp: string): number | null {
  const blockTime = Date.parse(timestamp);
  if (!Number.isFinite(blockTime)) {
    return null;
  }
  const diff = Date.now() - blockTime;
  if (diff <= 0) {
    return 0;
  }
  return Math.round(diff / 1000);
}

const blockchainSlice = createSlice({
  name: 'blockchain',
  initialState,
  reducers: {
    setStatus(state, action: PayloadAction<BlockchainState['status']>) {
      state.status = action.payload;
    },
    setError(state, action: PayloadAction<string | null>) {
      state.error = action.payload;
      state.status = action.payload ? 'error' : state.status;
    },
    blockReceived(state, action: PayloadAction<BlockNotificationPayload['payload']>) {
      const { blockNumber, timestamp, stats: rawStats } = action.payload;
      const stats = normalizeStats(rawStats ?? {});
      const summary: BlockSummary = {
        blockNumber,
        timestamp,
        transactionCount: stats.transactions,
        stats
      };

      state.history = [summary, ...state.history.filter(block => block.blockNumber !== blockNumber)].slice(0, MAX_HISTORY);
      state.latestBlock = summary;

      const metrics = computeMetrics(state.history);
      state.metrics = {
        ...metrics,
        networkLagSeconds: computeNetworkLagSeconds(timestamp)
      };

      state.lastUpdated = new Date().toISOString();
      state.status = 'ready';
      state.error = null;
    },
    resetBlockchain: () => createInitialState()
  }
});

export const { blockReceived, resetBlockchain, setError, setStatus } = blockchainSlice.actions;
export default blockchainSlice.reducer;
