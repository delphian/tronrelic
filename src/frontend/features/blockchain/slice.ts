import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { BlockNotificationPayload } from '@/shared';

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
  /**
   * Whether the block's receipt-derived stats were actually measured. False
   * when the backend had receipt fetching switched off, or when the fetch came
   * back short. In both cases `stats.totalEnergyUsed`, `totalEnergyCost`,
   * `totalBandwidthUsed`, and `internalTransactions` are zero or undercounted,
   * so a component must not display them as measured figures.
   */
  receiptsFetched: boolean;
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
      const { blockNumber, timestamp, receiptsFetched, stats: rawStats } = action.payload;
      const stats = normalizeStats(rawStats ?? {});
      const summary: BlockSummary = {
        blockNumber,
        timestamp,
        transactionCount: stats.transactions,
        // An older backend omits the flag, and so did every block indexed
        // before it existed. Both mean the receipt figures were never taken,
        // which is what `false` says.
        receiptsFetched: receiptsFetched === true,
        stats
      };

      // Insert by block number rather than prepending. Sync emits a block from
      // the backfill queue on the same channel as a live one, and a backfilled
      // block is older than everything already here. Prepending it would put
      // the list out of order, and `computeMetrics` reads the first and last
      // entries as the ends of a time window, so one out-of-order entry
      // corrupts the average block time and the transactions-per-second figure.
      const withoutDuplicate = state.history.filter(block => block.blockNumber !== blockNumber);
      const insertAt = withoutDuplicate.findIndex(block => block.blockNumber < blockNumber);
      const position = insertAt === -1 ? withoutDuplicate.length : insertAt;
      withoutDuplicate.splice(position, 0, summary);
      state.history = withoutDuplicate.slice(0, MAX_HISTORY);

      // Only advance the headline block. A backfilled block arriving live would
      // otherwise make the ticker jump backwards to a block from hours ago and
      // present it as the chain head.
      const isNewer = !state.latestBlock || blockNumber >= state.latestBlock.blockNumber;
      if (isNewer) {
        state.latestBlock = summary;
      }

      const metrics = computeMetrics(state.history);
      state.metrics = {
        ...metrics,
        // Lag describes how far the head is behind now, so it has to come from
        // the block being shown as the head — not from whichever block this
        // event happened to carry.
        networkLagSeconds: computeNetworkLagSeconds(state.latestBlock?.timestamp ?? timestamp)
      };

      state.lastUpdated = new Date().toISOString();
      state.status = 'ready';
      state.error = null;
    },
    resetBlockchain: () => createInitialState(),

    /**
     * Initialize Redux state with SSR block data.
     * Called once on hydration when SSR data is available but Redux is empty.
     * Does not override existing Redux data (WebSocket updates take precedence).
     */
    setInitialBlock(state, action: PayloadAction<BlockSummary>) {
      // Only set if Redux doesn't already have data (SSR hydration case)
      if (state.latestBlock) {
        return;
      }

      const summary = action.payload;
      state.latestBlock = summary;
      state.history = [summary];
      state.metrics = {
        ...computeMetrics([summary]),
        networkLagSeconds: computeNetworkLagSeconds(summary.timestamp)
      };
      state.status = 'ready';
      state.lastUpdated = new Date().toISOString();
    }
  }
});

export const { blockReceived, resetBlockchain, setError, setStatus, setInitialBlock } = blockchainSlice.actions;
export default blockchainSlice.reducer;
