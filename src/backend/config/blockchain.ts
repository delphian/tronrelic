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
    // stops. Off by default, and superseded by `emitBuffer` below. Holding the
    // cursor back never buffered any work: the scheduler enqueues every block
    // from the cursor up to this target on each tick, so raising it only made
    // the cursor settle that many blocks lower while the batch stayed exactly
    // the chain's production over one tick. Queue depth still fell to zero at
    // the tick boundary, and the held-back blocks had no queued job, so they
    // could not cover a late tick. The buffer that holds real, already-fetched
    // blocks is the emitter's. Leave this at zero unless a deployment wants
    // deliberate distance from a tip its provider serves inconsistently, and
    // keep it well below `liveChainThrottleBlocks`, because the lag it adds
    // counts toward the block age that decides whether a block is paced at all.
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
  // The backend playout buffer. Ingestion no longer waits between blocks, so
  // the worker fetches a tick's blocks flat out and hands each finished event
  // to `BlockEmitter`, which holds a lead of real blocks and releases them on
  // its own clock. That lead is what covers a slow TronGrid response, a retry,
  // or a late scheduler tick — none of which the old arrangement could absorb,
  // because the three-second wait sat inside the single serial worker and so
  // blocked the next fetch instead of buffering anything.
  //
  // The lead costs latency, but less than the arrangement it replaces: paced
  // ingestion stretched each one-minute batch across the whole minute, leaving
  // the feed about twenty blocks behind the chain with nothing held in reserve.
  emitBuffer: {
    // Blocks to hold. Eight covers a fully missed sync tick plus a skipped
    // chain slot. Raising it buys cover for longer stalls at three seconds of
    // feed latency per block, and zero disables buffering entirely, which is
    // the behaviour-preserving setting for a staged rollout.
    targetDepth: toNumber(process.env.BLOCKCHAIN_EMIT_BUFFER_TARGET_DEPTH, 8),
    // Depth at which the buffer starts draining faster than the chain
    // produces, so the burst a tick delivers does not settle in as permanent
    // latency. Must stay above `targetDepth` or it would claim the steady
    // state and the buffer would never hold its lead.
    catchupDepth: toNumber(process.env.BLOCKCHAIN_EMIT_BUFFER_CATCHUP_DEPTH, 13),
    // Depth beyond which blocks go out with no wait at all. At this point the
    // emitter is so far behind that latency hurts more than jitter, and a
    // buffer this deep means something upstream is wrong rather than uneven.
    maxDepth: toNumber(process.env.BLOCKCHAIN_EMIT_BUFFER_MAX_DEPTH, 40),
    // Spacing used while the buffer is below target. Deliberately longer than
    // one block time: releasing slower than blocks arrive is the only way a
    // lead spent on a hole can grow back, and it is the piece the frontend
    // playout buffer lacks, which is why that one covers a single gap and then
    // runs flat. At 3300ms the buffer regains one block of lead per ten
    // released, so a hole costs about thirty seconds of slightly slower feed.
    refillIntervalMs: toNumber(process.env.BLOCKCHAIN_EMIT_BUFFER_REFILL_MS, 3300),
    // Spacing used above `catchupDepth`. Mirrors the frontend playout buffer's
    // own catch-up interval so a backlog drains at the same rate on both sides.
    catchupIntervalMs: toNumber(process.env.BLOCKCHAIN_EMIT_BUFFER_CATCHUP_MS, 2000)
  },
  lock: {
    key: `${env.REDIS_NAMESPACE}:locks:blockchain-sync`,
    // Sized just under the sync cron period so the lock always self-releases
    // before the next tick, even if a run dies without reaching its release.
    // Change this whenever the `blockchain:sync` schedule changes: a TTL longer
    // than the period silently skips ticks, and one much shorter lets two runs
    // overlap and race the cursor.
    ttlSeconds: toNumber(process.env.BLOCK_SYNC_LOCK_TTL, 14)
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
