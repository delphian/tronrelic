import { env } from './env.js';

const toNumber = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const blockchainConfig = {
  batchSize: toNumber(process.env.BLOCK_SYNC_BATCH_SIZE, 60),
  maxBackfillPerRun: toNumber(process.env.BLOCK_SYNC_MAX_BACKFILL, 240),
  maxNetworkLagBeforeBackoff: toNumber(process.env.BLOCK_SYNC_MAX_LAG, 180),
  metrics: {
    sampleSize: toNumber(process.env.BLOCKCHAIN_METRICS_SAMPLE_SIZE, 180),
    smoothingWindowMinutes: toNumber(process.env.BLOCKCHAIN_METRICS_WINDOW_MINUTES, 15)
  },
  network: {
    blocksPerMinute: toNumber(process.env.BLOCKCHAIN_NETWORK_BLOCKS_PER_MINUTE, 20),
    blockIntervalSeconds: toNumber(process.env.BLOCKCHAIN_BLOCK_INTERVAL_SECONDS, 3),
    // The two blocks-behind figures below are a hysteresis pair, not one
    // threshold written twice. A single boundary makes the syncer flap: with lag
    // hovering on it, consecutive blocks alternate between the live 3-second
    // pacing and flat-out catch-up, which stutters the frontend feed and fills
    // the log with mode transitions. Sync drops the pacing only once lag reaches
    // `backfillEntryBlocks`, and resumes it only once lag falls back to
    // `liveChainThrottleBlocks`; between the two it holds whichever mode it is
    // already in. Keep entry strictly above the throttle value — equal values
    // collapse the band and bring the flapping back.
    liveChainThrottleBlocks: toNumber(process.env.BLOCKCHAIN_LIVE_CHAIN_THROTTLE_BLOCKS, 20),
    backfillEntryBlocks: toNumber(process.env.BLOCKCHAIN_BACKFILL_ENTRY_BLOCKS, 30),
    // How many blocks behind the chain head the forward cursor deliberately
    // stops. Off by default, because holding the cursor back does not buffer any
    // work. The scheduler enqueues every block from the cursor up to this target
    // on each tick, so raising it only makes the cursor settle that many blocks
    // lower: the batch size stays exactly the chain's production over one tick,
    // and queue depth still falls to zero at the tick boundary. The one
    // guaranteed effect is latency, since every block then reaches the frontend
    // this many block times late. Uneven arrival is smoothed on the client
    // instead, by the playout buffer in `SocketBridge`, which holds real blocks
    // and releases them on its own clock. Set this above zero only when a
    // deployment wants deliberate distance from the tip, and keep it well below
    // `liveChainThrottleBlocks`, because the lag it adds counts toward the block
    // age that decides whether a block is paced at all.
    liveTipReserveBlocks: toNumber(process.env.BLOCKCHAIN_LIVE_TIP_RESERVE_BLOCKS, 0),
    // The most pacing debt one stall may repay, measured in blocks. The pacer
    // spaces broadcasts against a running deadline, so a block that overruns
    // shortens the next wait instead of drifting permanently late. Left
    // unbounded, an outage would leave that deadline minutes in the past and
    // every held-back block would fire back to back the moment sync recovered —
    // the burst the pacer exists to prevent. This caps the recovery to a short
    // fast stretch before the normal cadence resumes.
    maxPacingDebtBlocks: toNumber(process.env.BLOCKCHAIN_MAX_PACING_DEBT_BLOCKS, 3)
  },
  lock: {
    key: `${env.REDIS_NAMESPACE}:locks:blockchain-sync`,
    ttlSeconds: toNumber(process.env.BLOCK_SYNC_LOCK_TTL, 55)
  },
  retry: {
    retries: toNumber(process.env.BLOCK_SYNC_RETRIES, 3),
    delayMs: toNumber(process.env.BLOCK_SYNC_RETRY_DELAY_MS, 750),
    factor: toNumber(process.env.BLOCK_SYNC_RETRY_FACTOR, 2)
  },
  thresholds: {
    stakeAmountTRX: toNumber(process.env.BLOCKCHAIN_STAKE_AMOUNT_TRX, 100_000),
    delegationAmountTRX: toNumber(process.env.BLOCKCHAIN_DELEGATION_AMOUNT_TRX, 50_000)
  },
  retention: {
    // Blocks are kept longer than transactions (4 days) because each block document
    // carries its own aggregate stats, which stay chartable after the underlying
    // transactions are pruned. The transaction-timeseries API clamps its `days`
    // parameter to this window, so shrinking it shortens that endpoint's reach.
    blockHours: toNumber(process.env.BLOCKCHAIN_RETENTION_BLOCK_HOURS, 24 * 32)
  },
  parity: {
    durableObjectHeightMetaKey: 'durableObjectLastHeight'
  }
};

export type BlockchainConfig = typeof blockchainConfig;
