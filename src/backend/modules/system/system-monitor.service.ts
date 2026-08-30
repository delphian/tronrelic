import type { Redis as RedisClient } from 'ioredis';
import type { IDatabaseService } from '@/types';
import * as os from 'os';
import { statfs } from 'fs/promises';
import mongoose from 'mongoose';
import { DockerStatsService, type DockerStatus } from './docker-stats.service.js';
import { SyncStateModel, type SyncStateFields } from '../../database/models/sync-state-model.js';
import { BlockModel, type BlockFields, type BlockDoc } from '../../database/models/block-model.js';
import { TransactionModel, type TransactionDoc } from '../../database/models/transaction-model.js';
import { TronGridClient } from '../blockchain/tron-grid.client.js';
import { BlockEmitter } from '../blockchain/block-emitter.js';
import { BlockchainService } from '../blockchain/blockchain.service.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../config/env.js';
import { blockchainConfig } from '../../config/blockchain.js';

const SYNC_STATE_COLLECTION = 'sync_states';
const BLOCKS_COLLECTION = 'blocks';
const TRANSACTIONS_COLLECTION = 'transactions';
interface TimeoutResult<T> {
  timedOut: boolean;
  value?: T;
  error?: unknown;
}

async function raceWithTimeout<T>(promise: Promise<T>, ms: number): Promise<TimeoutResult<T>> {
  let timeoutId: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<TimeoutResult<T>>(resolve => {
    timeoutId = setTimeout(() => resolve({ timedOut: true }), ms);
  });

  const wrapped = promise
    .then(value => ({ timedOut: false as const, value }))
    .catch(error => ({ timedOut: false as const, error }));

  const result = await Promise.race([wrapped, timeoutPromise]);

  if (timeoutId) {
    clearTimeout(timeoutId);
  }

  if (result.timedOut) {
    // ensure rejections are handled even after timeout
    promise.catch(() => {});
  }

  return result;
}

/**
 * Safely converts a date to ISO string, returning null if invalid
 */
function safeToISOString(date: any): string | null {
  if (!date) return null;
  const d = new Date(date);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export interface BlockchainSyncError {
  blockNumber: number;
  message: string;
  at?: string;
}

export interface BlockchainSyncStatus {
  currentBlock: number;
  networkBlock: number;
  lag: number;
  backfillQueueSize: number;
  lastProcessedAt: string | null;
  lastProcessedBlockId: string | null;
  lastProcessedBlockNumber: number | null;
  isHealthy: boolean;
  estimatedCatchUpTime: number | null;
  lastError: string | BlockchainSyncError | null;
  lastErrorAt: string | null;
  processingBlocksPerMinute: number | null;
  networkBlocksPerMinute: number;
  netCatchUpRate: number | null;
  averageProcessingDelaySeconds: number | null;
  lastTimings: Record<string, number> | null;
  lastTransactionCount: number | null;
  liveChainThrottleBlocks: number;
  backfillEntryBlocks: number;
  /**
   * How many blocks behind the head the syncer deliberately stops
   * (`BLOCKCHAIN_LIVE_TIP_RESERVE_BLOCKS`), zero unless a deployment configured
   * distance from the tip. Echoed because `lag` is measured against the raw
   * chain head while the syncer's own mode boundary is measured against the
   * tip, so a console that did not know about the reserve would start warning
   * that many blocks early on a deployment that set one.
   */
  liveTipReserveBlocks: number;
  /**
   * Seconds between blocks the emitter releases at
   * (`BLOCKCHAIN_BLOCK_INTERVAL_SECONDS`). Echoed so the console can judge a
   * cycle's end-to-end duration against the deployment's own block period
   * rather than assuming TRON's default three seconds.
   */
  blockIntervalSeconds: number;
  /**
   * Height of the last block actually broadcast, or null before the first one.
   *
   * Taken from the committer rather than the emitter, because a viewer sees a
   * block only once `block:new` goes out, and that happens inside the commit
   * after the write. The emitter records a height the moment it hands a block
   * over, which during a commit backlog is a block nobody has received.
   *
   * This normally matches `currentBlock`, since the same commit that broadcasts
   * the block also advances the cursor. The two diverge only by how stale the
   * cursor read is: `currentBlock` comes from MongoDB and can lag a scheduler
   * tick, while this is read live from the running committer.
   */
  lastEmittedBlockNumber: number | null;
  /**
   * Blocks between the chain head and the last broadcast block — the delay a
   * viewer actually experiences.
   *
   * In a healthy deployment this sits near the emitter's target depth by
   * design, because that lead is what covers an upstream hiccup. It rises above
   * that when commits back up behind the release clock, which is the case the
   * emitter's own figures cannot show. Falls back to `lag` before the first
   * commit completes, since nothing has been broadcast at all by then.
   */
  feedLag: number;
  /** Blocks the emitter is holding now; the lead available to cover a hiccup. */
  emitBufferDepth: number;
  /** The lead the emitter aims to hold, so a console can judge depth against it. */
  emitBufferTargetDepth: number;
  /** False while the emitter is still building its initial lead after a restart. */
  emitBufferSeeded: boolean;
  /**
   * How many times the buffer has drained to empty since the process started.
   *
   * The single number that says whether the lead is sized right: a deployment
   * holding a real lead never reaches zero, so any increase means the feed was
   * exposed to an upstream gap and the target depth is too small for what this
   * deployment's provider actually does.
   */
  emitBufferUnderruns: number;
  /**
   * Blocks that were given a slot and are still being written.
   *
   * The emitter's depth says how many blocks are waiting for a slot; this says
   * how many have had one and have not landed yet. Anything above zero for more
   * than a moment means committing is slower than the release clock, which is
   * the one failure this pipeline can produce that no other figure here shows.
   */
  commitQueueDepth: number;
  /**
   * Commits that threw since the process started.
   *
   * A rising count means blocks are reaching no surface at all — not the
   * database, not observers, not the feed. The sync cursor does not advance past
   * a failed commit, so the next tick refetches those blocks; a count that keeps
   * climbing means that retry is failing too.
   */
  commitFailures: number;
}

export interface TransactionStats {
  totalIndexed: number;
  indexedToday: number;
  byType: Record<string, number>;
}

export interface BlockProcessingMetrics {
  averageBlockProcessingTime: number | null;
  blocksPerMinute: number | null;
  successRate: number;
  recentErrors: Array<{
    blockNumber: number;
    timestamp: string;
    message: string;
  }>;
  averageProcessingDelaySeconds: number | null;
  averageProcessingIntervalSeconds: number | null;
  networkBlocksPerMinute: number;
  netCatchUpRate: number | null;
  projectedCatchUpMinutes: number | null;
  backfillQueueSize: number;
}

interface BlockProcessingSnapshot {
  averageProcessingDelaySeconds: number | null;
  averageProcessingIntervalSeconds: number | null;
  processedBlocksPerMinute: number | null;
  successRate: number;
  recentErrors: BlockProcessingMetrics['recentErrors'];
  backfillQueueSize: number;
  lastProcessedAt: string | null;
  lastProcessedBlockId: string | null;
  lastProcessedBlockNumber: number | null;
  networkBlocksPerMinute: number;
  netCatchUpRate: number | null;
}

export interface SchedulerHealth {
  enabled: boolean;
  uptime: number | null;
}

export interface DatabaseStatus {
  connected: boolean;
  responseTime: number | null;
  poolSize: number;
  availableConnections: number;
  databaseSize: number | null;
  collectionCount: number;
  recentErrors: string[];
}

export interface RedisStatus {
  connected: boolean;
  responseTime: number | null;
  memoryUsage: number | null;
  keyCount: number;
  evictions: number;
  hitRate: number | null;
}

export interface ClickHouseStatus {
  connected: boolean;
  responseTime: number | null;
  tableCount: number;
  databaseSize: number | null;
}

export interface ServerMetrics {
  uptime: number;
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
    external: number;
  };
  /**
   * This process's CPU consumption as a percentage of one core, measured over
   * the interval since the previous call.
   *
   * Previously this reported `os.cpus()` averaged since boot, which inside a
   * container is the *host's* lifetime CPU average — neither the backend
   * process nor a current reading, despite the field name. Host CPU now lives
   * on `HostMetrics.cpuPercent`, where it is also windowed.
   */
  cpuUsage: number;
  /** Cores visible to the host, for reading `cpuUsage` against capacity. */
  cpuCoreCount: number;
  activeConnections: number;
  requestRate: number | null;
  errorRate: number | null;
}

/**
 * Space consumption for one mounted filesystem.
 *
 * Reported because the ClickHouse `traffic_events` table grows without bound
 * and, before it was moved to a dedicated block device, was capable of filling
 * the droplet root disk and taking every container down with it.
 */
export interface DiskUsage {
  /** Mount point as seen from inside this container. */
  path: string;
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usedPercent: number;
}

/**
 * Droplet-level readings, as distinct from this process or any one container.
 *
 * Container metrics answer "which service is consuming the machine"; these
 * answer "is the machine itself under pressure" — the question that decides
 * whether to resize the droplet or hunt for a leak.
 */
export interface HostMetrics {
  hostname: string;
  platform: string;
  /** Seconds since the host booted, not since this process started. */
  uptime: number;
  cpuCoreCount: number;
  /**
   * Host CPU across all cores over the interval since the previous call, or
   * null on the very first reading before a window exists.
   */
  cpuPercent: number | null;
  /** One, five and fifteen minute load averages. */
  loadAverage: [number, number, number];
  memoryTotal: number;
  memoryFree: number;
  memoryUsed: number;
  memoryPercent: number;
  /** Filesystems probed from inside this container; empty if statfs failed. */
  disks: DiskUsage[];
}

/**
 * Combined droplet and container view backing the console's Server section.
 *
 * The two travel together because they answer one operator question and would
 * otherwise cost two polls against a rate-limited admin router, but each keeps
 * its own failure state so a Docker outage cannot blank the host readings.
 */
export interface InfrastructureStatus {
  host: HostMetrics;
  docker: DockerStatus;
}

/** Cumulative CPU counters plus the moment they were sampled. */
interface ICpuSample {
  /** Aggregate busy time across all cores, in milliseconds. */
  busyMs: number;
  /** Aggregate time across all cores including idle, in milliseconds. */
  totalMs: number;
}

export interface ConfigurationValues {
  environment: string;
  port: number;
  features: {
    scheduler: boolean;
    websockets: boolean;
    telemetry: boolean;
  };
  limits: Record<string, never>;
  integrations: {
    hasTronGridKey: boolean;
    hasStorageConfigured: boolean;
  };
}

/**
 * Snapshot the host's cumulative CPU counters across every core.
 *
 * Kept separate from the percentage calculation because a rate needs two
 * samples taken at different times; this produces the raw reading, and the
 * caller owns the pair it compares.
 *
 * @returns Aggregate busy and total core time in milliseconds.
 */
function readHostCpuSample(): ICpuSample {
  let busyMs = 0;
  let totalMs = 0;

  for (const cpu of os.cpus()) {
    const coreTotal = Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
    busyMs += coreTotal - cpu.times.idle;
    totalMs += coreTotal;
  }

  return { busyMs, totalMs };
}

/**
 * Derive the used/percentage fields callers actually display from raw capacity.
 *
 * Centralized so the root filesystem and ClickHouse's own disks — which arrive
 * from entirely different sources — cannot drift into reporting "used" by
 * different definitions.
 *
 * @param path - Identifier shown to the operator.
 * @param totalBytes - Filesystem capacity.
 * @param freeBytes - Space available to unprivileged writers.
 * @returns The populated usage record.
 */
function toDiskUsage(path: string, totalBytes: number, freeBytes: number): DiskUsage {
  const usedBytes = Math.max(0, totalBytes - freeBytes);

  return {
    path,
    totalBytes,
    freeBytes,
    usedBytes,
    usedPercent: totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0
  };
}

export class SystemMonitorService {
  /**
   * How long a computed block-processing snapshot stays fresh. The /system
   * dashboard polls the status and metrics endpoints from multiple components
   * every 10–15 seconds, and both endpoints derive from the same snapshot —
   * a short TTL lets all of those requests share one database query instead
   * of each launching its own scan of the blocks collection.
   */
  private static readonly SNAPSHOT_CACHE_TTL_MS = 5000;

  private readonly database: IDatabaseService;

  /**
   * In-flight or recently resolved snapshot shared across concurrent callers.
   * Stores the promise (not the resolved value) so requests arriving while a
   * computation is still running attach to it rather than issuing a second
   * query — the pile-up of overlapping snapshot queries is what previously
   * saturated MongoDB when the dashboard polled faster than queries finished.
   */
  private snapshotCache: { promise: Promise<BlockProcessingSnapshot>; fetchedAt: number } | null = null;

  /** Reads sibling-container metrics; reports unavailable when no Docker API is configured. */
  private readonly dockerStats: DockerStatsService;

  /**
   * Previous host CPU counters, for turning cumulative times into a rate.
   *
   * Seeded in the constructor so the first request already has a window to
   * measure against, rather than returning null until a second poll arrives.
   */
  private lastHostCpu: ICpuSample;

  /** Previous process CPU counters and the wall-clock moment they were taken. */
  private lastProcessCpu: { usage: NodeJS.CpuUsage; atMs: number };

  /**
   * Last CPU percentage accepted from a long-enough sampling window.
   *
   * Held so a sub-50ms repeat call republishes the previous reading instead of
   * a literal 0%, which reads as an idle backend to whoever is watching the
   * console. The console makes that a routine case rather than a corner one:
   * the Overview strip and the Server section poll the same endpoint on their
   * own timers and both fire when the page mounts.
   */
  private lastProcessCpuPercent = 0;

  constructor(
    private readonly redis: RedisClient,
    database: IDatabaseService,
    dockerStats: DockerStatsService = new DockerStatsService()
  ) {
    this.database = database;
    this.database.registerModel(SYNC_STATE_COLLECTION, SyncStateModel);
    this.database.registerModel(BLOCKS_COLLECTION, BlockModel);
    this.database.registerModel(TRANSACTIONS_COLLECTION, TransactionModel);
    this.dockerStats = dockerStats;
    this.lastHostCpu = readHostCpuSample();
    this.lastProcessCpu = { usage: process.cpuUsage(), atMs: Date.now() };
  }

  /**
   * Get the registered model for database operations.
   */
  private getSyncStateModel() {
    return this.database.getModel<SyncStateFields>(SYNC_STATE_COLLECTION);
  }

  private getBlockModel() {
    return this.database.getModel<BlockDoc>(BLOCKS_COLLECTION);
  }

  private getTransactionModel() {
    return this.database.getModel<TransactionDoc>(TRANSACTIONS_COLLECTION);
  }

  /**
   * Return the block-processing snapshot, serving concurrent and rapid
   * repeat callers from a single shared computation.
   *
   * Both getBlockchainSyncStatus() and getBlockProcessingMetrics() need this
   * snapshot, and the dashboard requests them together — without sharing, one
   * poll cycle runs the underlying blocks query four times. If the cached
   * computation fails, the cache entry is cleared so the next caller retries
   * rather than being served the same rejection for the full TTL.
   *
   * The TTL measures time since the last successful resolution, not since the
   * computation started, and an in-flight computation never expires. Measuring
   * from the start would let a query slower than the TTL be overtaken by a
   * second concurrent scan — the pile-up this cache exists to prevent, and the
   * regime a slow query already signals.
   *
   * @param state - Current sync state document; passed through to the
   *   computation for backfill-queue and error metadata. Within the cache TTL
   *   the state captured by the first caller is used for all callers.
   * @returns The shared snapshot of recent block-processing performance.
   */
  private getBlockProcessingSnapshot(state: SyncStateFields | null): Promise<BlockProcessingSnapshot> {
    const now = Date.now();

    if (!this.snapshotCache || now - this.snapshotCache.fetchedAt >= SystemMonitorService.SNAPSHOT_CACHE_TTL_MS) {
      // An infinite fetchedAt keeps the entry unexpirable while the query runs;
      // it is replaced with the real completion time once the promise settles.
      const entry: { promise: Promise<BlockProcessingSnapshot>; fetchedAt: number } = {
        promise: this.computeBlockProcessingSnapshot(state),
        fetchedAt: Number.POSITIVE_INFINITY
      };

      entry.promise.then(
        () => {
          entry.fetchedAt = Date.now();
        },
        () => {
          if (this.snapshotCache === entry) {
            this.snapshotCache = null;
          }
        }
      );

      this.snapshotCache = entry;
    }

    return this.snapshotCache.promise;
  }

  /**
   * Compute block-processing metrics (process rate, delay, success rate) from
   * the most recently processed blocks.
   *
   * Samples the newest `metrics.sampleSize` blocks by `processedAt` — that
   * field is indexed on the block schema specifically so this sort resolves
   * via the index; do not remove the index without rethinking this query.
   * Callers should prefer getBlockProcessingSnapshot(), which caches and
   * deduplicates this computation across concurrent dashboard polls.
   *
   * @param state - Current sync state document supplying backfill-queue depth
   *   and last-error metadata for the success-rate and error fields.
   * @returns Freshly computed snapshot of recent block-processing performance.
   */
  private async computeBlockProcessingSnapshot(state: SyncStateFields | null): Promise<BlockProcessingSnapshot> {
    const sampleSize = blockchainConfig.metrics?.sampleSize ?? 180;

    const blocks = await this.getBlockModel().find(
      {},
      { blockNumber: 1, blockId: 1, processedAt: 1, timestamp: 1 }
    )
      .sort({ processedAt: -1 })
      .limit(sampleSize)
      .lean() as BlockFields[];

    const normalized = blocks
      .filter(block => block?.processedAt && block?.timestamp)
      .map(block => {
        const processedAt = new Date(block.processedAt as Date | string | number);
        const blockTimestamp = new Date(block.timestamp as Date | string | number);
        const processedAtMs = processedAt.getTime();
        const timestampMs = blockTimestamp.getTime();

        if (!Number.isFinite(processedAtMs) || !Number.isFinite(timestampMs)) {
          return null;
        }

        return {
          blockNumber: block.blockNumber,
          blockId: 'blockId' in block ? (block as any).blockId ?? null : null,
          processedAtMs,
          timestampMs
        };
      })
      .filter(
        (
          value
        ): value is {
          blockNumber: number;
          blockId: string | null;
          processedAtMs: number;
          timestampMs: number;
        } => value !== null
      )
      .sort((a, b) => a.processedAtMs - b.processedAtMs);

    const smoothingMinutes = blockchainConfig.metrics?.smoothingWindowMinutes ?? 15;
    const cutoffMs = Date.now() - smoothingMinutes * 60 * 1000;
    const sample = normalized.filter(entry => entry.processedAtMs >= cutoffMs);
    const measurement = sample.length >= 2 ? sample : normalized;

    let averageProcessingDelaySeconds: number | null = null;
    let averageProcessingIntervalSeconds: number | null = null;
    let processedBlocksPerMinute: number | null = null;

    if (measurement.length > 0) {
      const delays = measurement
        .map(entry => Math.max(0, entry.processedAtMs - entry.timestampMs))
        .filter(delay => Number.isFinite(delay) && delay >= 0);

      if (delays.length > 0) {
        averageProcessingDelaySeconds = delays.reduce((sum, value) => sum + value, 0) / delays.length / 1000;
      }
    }

    if (measurement.length >= 2) {
      const intervals: number[] = [];
      for (let i = 1; i < measurement.length; i++) {
        const diff = measurement[i].processedAtMs - measurement[i - 1].processedAtMs;
        if (Number.isFinite(diff) && diff >= 0) {
          intervals.push(diff);
        }
      }

      if (intervals.length > 0) {
        const totalInterval = intervals.reduce((sum, value) => sum + value, 0);
        averageProcessingIntervalSeconds = totalInterval / intervals.length / 1000;
      }

      const totalSpanMs = measurement[measurement.length - 1].processedAtMs - measurement[0].processedAtMs;
      if (Number.isFinite(totalSpanMs) && totalSpanMs > 0) {
        processedBlocksPerMinute = (measurement.length * 60000) / totalSpanMs;
      } else if (averageProcessingIntervalSeconds && averageProcessingIntervalSeconds > 0) {
        processedBlocksPerMinute = 60 / averageProcessingIntervalSeconds;
      }
    }

    const networkBlocksPerMinute = blockchainConfig.network?.blocksPerMinute ?? 20;
    const netCatchUpRate =
      processedBlocksPerMinute !== null ? processedBlocksPerMinute - networkBlocksPerMinute : null;

    const meta = (state?.meta || {}) as Record<string, unknown>;
    const backfillQueue = Array.isArray(meta.backfillQueue) ? meta.backfillQueue : [];
    const successCount = normalized.length;
    const failureCount = backfillQueue.length;
    const successRate =
      successCount + failureCount === 0 ? 100 : (successCount / (successCount + failureCount)) * 100;

    const recentErrors: BlockProcessingMetrics['recentErrors'] = [];
    const rawError = meta.lastError;
    if (rawError) {
      if (typeof rawError === 'string') {
        recentErrors.push({
          blockNumber: 0,
          timestamp: safeToISOString(meta.lastErrorAt) ?? new Date().toISOString(),
          message: rawError
        });
      } else if (typeof rawError === 'object') {
        const errorRecord = rawError as Record<string, unknown>;
        const errorBlockNumber = Number(errorRecord.blockNumber) || 0;
        const errorTimestamp =
          safeToISOString(errorRecord.at) ?? safeToISOString(meta.lastErrorAt) ?? new Date().toISOString();
        const errorMessage =
          typeof errorRecord.message === 'string'
            ? errorRecord.message
            : JSON.stringify(errorRecord.message ?? errorRecord);
        recentErrors.push({
          blockNumber: errorBlockNumber,
          timestamp: errorTimestamp,
          message: errorMessage
        });
      }
    }

    const lastProcessedAt =
      safeToISOString(meta.lastProcessedAt) ??
      (normalized.length
        ? safeToISOString(new Date(normalized[normalized.length - 1].processedAtMs))
        : null);
    const lastProcessedBlockId =
      typeof meta.lastProcessedBlockId === 'string' ? meta.lastProcessedBlockId : null;
    const lastProcessedBlockNumber =
      typeof state?.cursor === 'object' && state?.cursor !== null && typeof (state.cursor as any).blockNumber === 'number'
        ? (state.cursor as any).blockNumber
        : normalized.length
          ? normalized[normalized.length - 1].blockNumber
          : null;

    return {
      averageProcessingDelaySeconds,
      averageProcessingIntervalSeconds,
      processedBlocksPerMinute,
      successRate,
      recentErrors,
      backfillQueueSize: failureCount,
      lastProcessedAt,
      lastProcessedBlockId,
      lastProcessedBlockNumber,
      networkBlocksPerMinute,
      netCatchUpRate
    };
  }

  async getBlockchainSyncStatus(): Promise<BlockchainSyncStatus> {
    const state = await this.getSyncStateModel().findOne({ key: 'blockchain:last-block' }).lean() as SyncStateFields | null;
    const tronClient = TronGridClient.getInstance();

    let networkBlock: number | null = null;
    try {
      const latestBlock = await tronClient.getNowBlock();
      networkBlock = latestBlock.block_header.raw_data.number;
    } catch (error) {
      logger.error({ error }, 'Failed to fetch network block height');
    }

    const meta = (state?.meta || {}) as Record<string, unknown>;
    const currentBlock =
      typeof state?.cursor === 'object' && state?.cursor !== null && typeof (state.cursor as any).blockNumber === 'number'
        ? (state.cursor as any).blockNumber
        : 0;

    let resolvedNetworkBlock = networkBlock;
    if (resolvedNetworkBlock === null && typeof meta.lastNetworkHeight === 'number') {
      const parsedNetworkHeight = Number(meta.lastNetworkHeight);
      resolvedNetworkBlock = Number.isFinite(parsedNetworkHeight) ? parsedNetworkHeight : null;
    }

    let networkBlockValue: number =
      resolvedNetworkBlock !== null && Number.isFinite(resolvedNetworkBlock)
        ? resolvedNetworkBlock
        : currentBlock;

    if (networkBlockValue < currentBlock) {
      networkBlockValue = currentBlock;
    }

    const snapshot = await this.getBlockProcessingSnapshot(state);
    const lag = Math.max(0, networkBlockValue - currentBlock);

    const isHealthy =
      lag < (blockchainConfig.maxNetworkLagBeforeBackoff ?? 100) &&
      snapshot.backfillQueueSize < (blockchainConfig.maxBackfillPerRun ?? 240);

    let estimatedCatchUpTime: number | null = null;
    if (lag > 0) {
      if (snapshot.netCatchUpRate !== null && snapshot.netCatchUpRate > 0) {
        estimatedCatchUpTime = Math.ceil(lag / snapshot.netCatchUpRate);
      } else if (snapshot.processedBlocksPerMinute !== null && snapshot.processedBlocksPerMinute > 0) {
        estimatedCatchUpTime = Math.ceil(lag / snapshot.processedBlocksPerMinute);
      }
    }

    const lastErrorRaw = meta.lastError ?? null;
    const lastError =
      typeof lastErrorRaw === 'string' || typeof lastErrorRaw === 'object' ? (lastErrorRaw as BlockchainSyncError | string) : null;
    const lastErrorAt = safeToISOString(meta.lastErrorAt);

    // Extract timing data from meta if available
    const lastTimings = (meta.lastTimings && typeof meta.lastTimings === 'object')
      ? (meta.lastTimings as Record<string, number>)
      : null;
    const lastTransactionCount = typeof meta.lastTransactionCount === 'number'
      ? meta.lastTransactionCount
      : null;
    const lastProcessedBlockNumber = typeof meta.lastProcessedBlockNumber === 'number'
      ? meta.lastProcessedBlockNumber
      : null;

    // Read straight from the emitter rather than from the sync state document.
    // The worker writes that document once per block, so between scheduler
    // ticks it stops updating while the emitter keeps releasing — a buffer
    // depth taken from Mongo would sit a whole tick stale exactly when an
    // operator is checking whether the feed is healthy.
    const emitBuffer = BlockEmitter.getInstance().getMetrics();

    // Read for the same reason as the buffer above: the commit backlog changes
    // between scheduler ticks, and a figure taken from the sync state document
    // would be stale exactly when writing has fallen behind and an operator is
    // looking for the cause.
    const commit = BlockchainService.getInstance().getCommitMetrics();

    // The broadcast height comes from the committer, not the emitter. A viewer
    // sees a block only once `block:new` goes out, and that happens inside the
    // commit after the write; the emitter records a height the moment it hands
    // the block over. In a healthy run the two are the same block, because the
    // commit chain drains well inside a release slot. When commits back up, or
    // when every commit is failing, the emitter's number keeps climbing for
    // blocks no client has received, and a feed lag derived from it would read
    // as healthy while the feed was stalled. Before the first commit finishes
    // nothing has been broadcast at all, so the lag falls back to the cursor
    // figure, which the commit itself advances.
    const lastEmittedBlockNumber = commit.lastCommittedBlockNumber;
    const feedLag = lastEmittedBlockNumber === null
      ? lag
      : Math.max(0, networkBlockValue - lastEmittedBlockNumber);

    return {
      currentBlock,
      networkBlock: networkBlockValue,
      lag,
      lastEmittedBlockNumber,
      feedLag,
      emitBufferDepth: emitBuffer.depth,
      emitBufferTargetDepth: emitBuffer.targetDepth,
      emitBufferSeeded: emitBuffer.seeded,
      emitBufferUnderruns: emitBuffer.underruns,
      commitQueueDepth: commit.queued,
      commitFailures: commit.failures,
      backfillQueueSize: snapshot.backfillQueueSize,
      lastProcessedAt: snapshot.lastProcessedAt,
      lastProcessedBlockId: snapshot.lastProcessedBlockId,
      lastProcessedBlockNumber,
      isHealthy,
      estimatedCatchUpTime,
      lastError,
      lastErrorAt,
      processingBlocksPerMinute: snapshot.processedBlocksPerMinute,
      networkBlocksPerMinute: snapshot.networkBlocksPerMinute,
      netCatchUpRate: snapshot.netCatchUpRate,
      averageProcessingDelaySeconds: snapshot.averageProcessingDelaySeconds,
      lastTimings,
      lastTransactionCount,
      liveChainThrottleBlocks: blockchainConfig.network.liveChainThrottleBlocks,
      backfillEntryBlocks: blockchainConfig.network.backfillEntryBlocks,
      liveTipReserveBlocks: blockchainConfig.network.liveTipReserveBlocks,
      blockIntervalSeconds: blockchainConfig.network.blockIntervalSeconds
    };
  }

  async getTransactionStats(): Promise<TransactionStats> {
    let total = 0;
    try {
      total = await this.getTransactionModel().estimatedDocumentCount();
    } catch (error) {
      logger.warn({ error }, 'Failed to estimate transaction count');
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const todayCount = 0;

    const typeAggregation: Array<{ _id: string; count: number }> = [];

    const byType: Record<string, number> = {};
    for (const item of typeAggregation) {
      byType[item._id] = item.count;
    }

    return {
      totalIndexed: total,
      indexedToday: todayCount,
      byType
    };
  }

  async getBlockProcessingMetrics(): Promise<BlockProcessingMetrics> {
    const state = await this.getSyncStateModel().findOne({ key: 'blockchain:last-block' }).lean() as SyncStateFields | null;
    const snapshot = await this.getBlockProcessingSnapshot(state);

    const cursorBlockNumber = snapshot.lastProcessedBlockNumber;
    const lastNetworkHeight = (state?.meta as any)?.lastNetworkHeight;
    const lag =
      typeof cursorBlockNumber === 'number' && typeof lastNetworkHeight === 'number'
        ? Math.max(0, lastNetworkHeight - cursorBlockNumber)
        : null;

    let projectedCatchUpMinutes: number | null = null;
    if (lag && snapshot.netCatchUpRate !== null && snapshot.netCatchUpRate > 0) {
      projectedCatchUpMinutes = Math.ceil(lag / snapshot.netCatchUpRate);
    } else if (lag && snapshot.processedBlocksPerMinute !== null && snapshot.processedBlocksPerMinute > 0) {
      projectedCatchUpMinutes = Math.ceil(lag / snapshot.processedBlocksPerMinute);
    }

    return {
      averageBlockProcessingTime: snapshot.averageProcessingDelaySeconds,
      blocksPerMinute: snapshot.processedBlocksPerMinute,
      successRate: snapshot.successRate,
      recentErrors: snapshot.recentErrors,
      averageProcessingDelaySeconds: snapshot.averageProcessingDelaySeconds,
      averageProcessingIntervalSeconds: snapshot.averageProcessingIntervalSeconds,
      networkBlocksPerMinute: snapshot.networkBlocksPerMinute,
      netCatchUpRate: snapshot.netCatchUpRate,
      projectedCatchUpMinutes,
      backfillQueueSize: snapshot.backfillQueueSize
    };
  }

  async getSchedulerHealth(): Promise<SchedulerHealth> {
    return {
      enabled: env.ENABLE_SCHEDULER,
      uptime: process.uptime()
    };
  }

  async getDatabaseStatus(): Promise<DatabaseStatus> {
    const connected = mongoose.connection.readyState === 1;

    let responseTime: number | null = null;
    if (connected && mongoose.connection.db) {
      const start = Date.now();
      const pingResult = await raceWithTimeout(mongoose.connection.db.admin().ping(), 2000);
      if (pingResult.timedOut) {
        logger.warn('Database ping timed out after 2000ms');
      } else if (pingResult.error) {
        logger.error({ error: pingResult.error }, 'Database ping failed');
      } else {
        responseTime = Date.now() - start;
      }
    }

    const poolSize = 10; // Default from Mongoose
    const availableConnections = poolSize; // Simplified

    let databaseSize: number | null = null;
    let collectionCount = 0;

    if (connected && mongoose.connection.db) {
      const statsResult = await raceWithTimeout(mongoose.connection.db.stats(), 2000);
      if (statsResult.timedOut) {
        logger.warn('MongoDB stats command timed out after 2000ms');
      } else if (statsResult.error) {
        logger.error({ error: statsResult.error }, 'Failed to fetch database stats');
      } else if (statsResult.value) {
        databaseSize = statsResult.value.dataSize;
        collectionCount = statsResult.value.collections;
      }
    }

    return {
      connected,
      responseTime,
      poolSize,
      availableConnections,
      databaseSize,
      collectionCount,
      recentErrors: []
    };
  }

  async getRedisStatus(): Promise<RedisStatus> {
    const connected = this.redis.status === 'ready';

    let responseTime: number | null = null;
    if (connected) {
      const start = Date.now();
      try {
        await this.redis.ping();
        responseTime = Date.now() - start;
      } catch (error) {
        logger.error({ error }, 'Redis ping failed');
      }
    }

    let memoryUsage: number | null = null;
    let keyCount = 0;
    let evictions = 0;

    if (connected) {
      try {
        const info = await this.redis.info('memory');
        const memMatch = info.match(/used_memory:(\d+)/);
        if (memMatch) {
          memoryUsage = parseInt(memMatch[1], 10);
        }

        const statsInfo = await this.redis.info('stats');
        const evictMatch = statsInfo.match(/evicted_keys:(\d+)/);
        if (evictMatch) {
          evictions = parseInt(evictMatch[1], 10);
        }

        keyCount = await this.redis.dbsize();
      } catch (error) {
        logger.error({ error }, 'Failed to fetch Redis stats');
      }
    }

    return {
      connected,
      responseTime,
      memoryUsage,
      keyCount,
      evictions,
      hitRate: null // Would need tracking
    };
  }

  /**
   * Report this Node process's own resource consumption.
   *
   * CPU is measured as a delta against the previous call rather than read from
   * `os.cpus()`. The old approach averaged host core times since boot, so in a
   * container it reported neither this process nor anything current — a busy
   * backend and an idle one produced the same figure, and the number barely
   * moved once the droplet had been up a few days.
   *
   * @returns Process uptime, memory breakdown, and windowed CPU percentage.
   */
  async getServerMetrics(): Promise<ServerMetrics> {
    const mem = process.memoryUsage();
    const now = Date.now();
    const usage = process.cpuUsage();
    const elapsedMs = now - this.lastProcessCpu.atMs;
    const busyMicros =
      usage.user - this.lastProcessCpu.usage.user + (usage.system - this.lastProcessCpu.usage.system);

    // Below ~50ms the sample is dominated by timer granularity and produces
    // wild readings, so republish the last accepted window rather than noise —
    // a literal 0% reads as an idle backend to whoever is watching the console.
    if (elapsedMs >= 50) {
      this.lastProcessCpuPercent = Math.max(0, (busyMicros / 1000 / elapsedMs) * 100);
      this.lastProcessCpu = { usage, atMs: now };
    }
    const cpuUsage = this.lastProcessCpuPercent;

    return {
      uptime: process.uptime(),
      memoryUsage: {
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        rss: mem.rss,
        external: mem.external
      },
      cpuUsage,
      cpuCoreCount: os.cpus().length,
      activeConnections: 0, // Would need tracking
      requestRate: null,
      errorRate: null
    };
  }

  /**
   * Report droplet-level and per-container state in one payload.
   *
   * Collected together so the console's Server section costs a single request
   * against a rate-limited admin router, but assembled independently: Docker
   * carries its own failure state, so an unreachable socket proxy still leaves
   * the host readings usable.
   *
   * @returns Host metrics alongside the container sweep.
   */
  async getInfrastructureStatus(): Promise<InfrastructureStatus> {
    const [host, docker] = await Promise.all([this.getHostMetrics(), this.dockerStats.getStatus()]);

    return { host, docker };
  }

  /**
   * Measure the droplet the containers share.
   *
   * CPU is windowed against the previous call for the same reason as the
   * process reading. Memory comes from `os` rather than a cgroup file because
   * the compose services declare no memory limits, so the host totals are the
   * real ceiling every container competes for.
   *
   * @returns Host CPU, load, memory, and filesystem usage.
   */
  async getHostMetrics(): Promise<HostMetrics> {
    const sample = readHostCpuSample();
    const busyDelta = sample.busyMs - this.lastHostCpu.busyMs;
    const totalDelta = sample.totalMs - this.lastHostCpu.totalMs;
    let cpuPercent: number | null = null;

    if (totalDelta > 0 && busyDelta >= 0) {
      cpuPercent = (busyDelta / totalDelta) * 100;
      this.lastHostCpu = sample;
    }

    const memoryTotal = os.totalmem();
    const memoryFree = os.freemem();
    const load = os.loadavg();

    return {
      hostname: os.hostname(),
      platform: `${os.type()} ${os.release()}`,
      uptime: os.uptime(),
      cpuCoreCount: os.cpus().length,
      cpuPercent,
      loadAverage: [load[0], load[1], load[2]],
      memoryTotal,
      memoryFree,
      memoryUsed: memoryTotal - memoryFree,
      memoryPercent: memoryTotal > 0 ? ((memoryTotal - memoryFree) / memoryTotal) * 100 : 0,
      disks: await this.readDisks()
    };
  }

  /**
   * Probe the filesystems whose exhaustion would take the deployment down.
   *
   * The container's root mount stands in for the droplet's system disk. The
   * ClickHouse volume is bound to a dedicated block device that this container
   * cannot see, so its figures come from ClickHouse's own `system.disks` — the
   * only vantage point with visibility into it, and the disk most likely to
   * fill given `traffic_events` grows without bound.
   *
   * @returns One entry per filesystem successfully probed; never throws.
   */
  private async readDisks(): Promise<DiskUsage[]> {
    const disks: DiskUsage[] = [];

    try {
      const stats = await statfs('/');
      const totalBytes = stats.blocks * stats.bsize;
      const freeBytes = stats.bavail * stats.bsize;
      disks.push(toDiskUsage('/', totalBytes, freeBytes));
    } catch (error) {
      logger.warn({ error }, 'Failed to read root filesystem usage');
    }

    try {
      const { ClickHouseService } = await import('../clickhouse/services/clickhouse.service.js');
      if (ClickHouseService.isInitialized()) {
        const clickhouse = ClickHouseService.getInstance();
        if (clickhouse.isConnected()) {
          const rows = await clickhouse.query<{ name: string; free_space: string; total_space: string }>(`
            SELECT name, free_space, total_space
            FROM system.disks
          `);
          for (const row of rows) {
            const totalBytes = parseInt(row.total_space, 10);
            const freeBytes = parseInt(row.free_space, 10);
            if (Number.isFinite(totalBytes) && Number.isFinite(freeBytes) && totalBytes > 0) {
              disks.push(toDiskUsage(`clickhouse:${row.name}`, totalBytes, freeBytes));
            }
          }
        }
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to read ClickHouse disk usage');
    }

    return disks;
  }

  /**
   * Get ClickHouse database connection status and metrics.
   *
   * Returns connection state, response time from ping, table count, and database size.
   * Handles cases where ClickHouse is not initialized (returns disconnected status).
   */
  async getClickHouseStatus(): Promise<ClickHouseStatus> {
    const { ClickHouseService } = await import('../clickhouse/services/clickhouse.service.js');

    // Check if ClickHouse service is initialized
    if (!ClickHouseService.isInitialized()) {
      return {
        connected: false,
        responseTime: null,
        tableCount: 0,
        databaseSize: null
      };
    }

    const clickhouse = ClickHouseService.getInstance();
    const connected = clickhouse.isConnected();

    let responseTime: number | null = null;
    let tableCount = 0;
    let databaseSize: number | null = null;

    if (connected) {
      // Measure ping response time
      const start = Date.now();
      const pingResult = await raceWithTimeout(clickhouse.ping(), 2000);
      if (!pingResult.timedOut && !pingResult.error && pingResult.value) {
        responseTime = Date.now() - start;
      } else if (pingResult.timedOut) {
        logger.warn('ClickHouse ping timed out after 2000ms');
      }

      // Get table count
      try {
        const tables = await clickhouse.query<{ count: string }>(`
          SELECT count() as count
          FROM system.tables
          WHERE database = currentDatabase()
        `);
        tableCount = tables.length > 0 ? parseInt(tables[0].count, 10) : 0;
      } catch (error) {
        logger.error({ error }, 'Failed to fetch ClickHouse table count');
      }

      // Get database size
      try {
        const sizeResult = await clickhouse.query<{ total_bytes: string }>(`
          SELECT sum(total_bytes) as total_bytes
          FROM system.tables
          WHERE database = currentDatabase()
        `);
        if (sizeResult.length > 0) {
          const bytes = sizeResult[0].total_bytes;
          databaseSize = bytes ? parseInt(bytes, 10) : 0;
        } else {
          databaseSize = 0;
        }
      } catch (error) {
        logger.error({ error }, 'Failed to fetch ClickHouse database size');
      }
    }

    return {
      connected,
      responseTime,
      tableCount,
      databaseSize
    };
  }

  async getConfiguration(): Promise<ConfigurationValues> {
    return {
      environment: env.ENV,
      port: env.PORT,
      features: {
        scheduler: env.ENABLE_SCHEDULER,
        websockets: env.ENABLE_WEBSOCKETS,
        telemetry: env.ENABLE_TELEMETRY
      },
      limits: {},
      integrations: {
        hasTronGridKey: !!env.TRONGRID_API_KEY,
        hasStorageConfigured: !!(env.STORAGE_BUCKET && env.STORAGE_ACCESS_KEY_ID)
      }
    };
  }

}
