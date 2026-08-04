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
    liveChainThrottleBlocks: toNumber(process.env.BLOCKCHAIN_LIVE_CHAIN_THROTTLE_BLOCKS, 20)
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
    // Blocks are kept longer than transactions (7 days) because each block document
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
