import type { Redis as RedisClient } from 'ioredis';
import * as os from 'os';
import mongoose from 'mongoose';
import { SyncStateModel, type SyncStateDoc, type SyncStateFields } from '../../database/models/sync-state-model.js';
import { BlockModel, type BlockFields } from '../../database/models/block-model.js';
import { TransactionModel, type TransactionFields } from '../../database/models/transaction-model.js';
import { MarketModel, type MarketFields } from '../../database/models/market-model.js';
import { MarketReliabilityModel, type MarketReliabilityFields } from '../../database/models/market-reliability-model.js';
import { SchedulerExecutionModel, type ISchedulerExecutionFields } from '../../database/models/scheduler-execution-model.js';
import { TronGridClient } from '../blockchain/tron-grid.client.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../config/env.js';
import { getScheduler } from '../../jobs/index.js';
import { blockchainConfig } from '../../config/blockchain.js';
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

export interface SchedulerJobStatus {
  name: string;
  schedule: string;
  enabled: boolean;
  lastRun: string | null;
  nextRun: string | null;
  status: 'running' | 'success' | 'failed' | 'never_run';
  duration: number | null;
  error: string | null;
}

export interface SchedulerHealth {
  enabled: boolean;
  uptime: number | null;
  totalJobsExecuted: number;
  successRate: number;
  overdueJobs: string[];
}

export interface MarketPlatformStatus {
  guid: string;
  name: string;
  lastFetchedAt: string | null;
  status: 'online' | 'stale' | 'failed' | 'disabled';
  responseTime: number | null;
  reliabilityScore: number;
  consecutiveFailures: number;
  isActive: boolean;
}

export interface MarketDataFreshness {
  oldestDataAge: number | null;
  stalePlatformCount: number;
  averageDataAge: number;
  platformsWithOldData: string[];
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

export interface ServerMetrics {
  uptime: number;
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
    external: number;
  };
  cpuUsage: number;
  activeConnections: number;
  requestRate: number | null;
  errorRate: number | null;
}

export interface ConfigurationValues {
  environment: string;
  port: number;
  features: {
    scheduler: boolean;
    websockets: boolean;
    telemetry: boolean;
  };
  thresholds: {
    delegationAmountTRX: number;
    stakeAmountTRX: number;
  };
  limits: Record<string, never>;
  integrations: {
    hasTronGridKey: boolean;
    hasTelegramBot: boolean;
    hasStorageConfigured: boolean;
  };
}

export class SystemMonitorService {
  constructor(private readonly redis: RedisClient) {}

  private async computeBlockProcessingSnapshot(state: SyncStateFields | null): Promise<BlockProcessingSnapshot> {
    const sampleSize = blockchainConfig.metrics?.sampleSize ?? 180;

    const blocks = await BlockModel.find(
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
    const state = await SyncStateModel.findOne({ key: 'blockchain:last-block' }).lean() as SyncStateFields | null;
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

    const snapshot = await this.computeBlockProcessingSnapshot(state);
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

    return {
      currentBlock,
      networkBlock: networkBlockValue,
      lag,
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
      liveChainThrottleBlocks: blockchainConfig.network.liveChainThrottleBlocks
    };
  }

  async getTransactionStats(): Promise<TransactionStats> {
    let total = 0;
    try {
      total = await TransactionModel.estimatedDocumentCount();
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
    const state = await SyncStateModel.findOne({ key: 'blockchain:last-block' }).lean() as SyncStateFields | null;
    const snapshot = await this.computeBlockProcessingSnapshot(state);

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

  async getSchedulerStatus(): Promise<SchedulerJobStatus[]> {
    const scheduler = getScheduler();
    if (!scheduler) {
      return [];
    }

    const jobConfigs = scheduler.getAllJobConfigs();
    const jobs: SchedulerJobStatus[] = [];

    for (const config of jobConfigs) {
      // Get the most recent execution for this job
      const lastExecution = await SchedulerExecutionModel.findOne({ jobName: config.name })
        .sort({ startedAt: -1 })
        .lean() as ISchedulerExecutionFields | null;

      let status: 'running' | 'success' | 'failed' | 'never_run' = 'never_run';
      let lastRun: string | null = null;
      let duration: number | null = null;
      let error: string | null = null;

      if (lastExecution) {
        status = lastExecution.status;
        lastRun = safeToISOString(lastExecution.startedAt);
        duration = lastExecution.duration ? lastExecution.duration / 1000 : null; // Convert ms to seconds
        error = lastExecution.error;
      }

      jobs.push({
        name: config.name,
        schedule: config.schedule,
        enabled: config.enabled,
        lastRun,
        nextRun: null, // node-cron doesn't provide next run time easily
        status: config.enabled ? status : 'never_run',
        duration,
        error
      });
    }

    return jobs;
  }

  async getSchedulerHealth(): Promise<SchedulerHealth> {
    return {
      enabled: env.ENABLE_SCHEDULER,
      uptime: process.uptime(),
      totalJobsExecuted: 0, // Would need tracking
      successRate: 100,
      overdueJobs: []
    };
  }

  async getMarketPlatformStatus(): Promise<MarketPlatformStatus[]> {
    const markets = await MarketModel.find().lean() as MarketFields[];
    const reliability = await MarketReliabilityModel.find().lean() as MarketReliabilityFields[];

    const reliabilityMap = new Map(reliability.map(r => [r.guid, r]));

    return markets.map(market => {
      const rel = reliabilityMap.get(market.guid);
      const lastFetchedAt = safeToISOString(market.lastUpdated);

      let status: 'online' | 'stale' | 'failed' | 'disabled' = 'online';
      if (!market.isActive) {
        status = 'disabled';
      } else if (lastFetchedAt) {
        const ageMinutes = (Date.now() - new Date(lastFetchedAt).getTime()) / 1000 / 60;
        if (ageMinutes > 60) {
          status = 'failed';
        } else if (ageMinutes > 10) {
          status = 'stale';
        }
      } else {
        status = 'failed';
      }

      return {
        guid: market.guid,
        name: market.name,
        lastFetchedAt,
        status,
        responseTime: null,
        reliabilityScore: rel?.reliability || 0,
        consecutiveFailures: rel?.failureStreak || 0,
        isActive: market.isActive
      };
    });
  }

  async getMarketDataFreshness(): Promise<MarketDataFreshness> {
    const markets = await MarketModel.find({ isActive: true }).lean() as MarketFields[];

    if (markets.length === 0) {
      return {
        oldestDataAge: null,
        stalePlatformCount: 0,
        averageDataAge: 0,
        platformsWithOldData: []
      };
    }

    const now = Date.now();
    const ages = markets
      .filter(m => m.lastUpdated)
      .map(m => now - new Date(m.lastUpdated!).getTime());

    const oldestDataAge = ages.length > 0 ? Math.max(...ages) / 1000 / 60 : null;
    const averageDataAge = ages.length > 0 ? ages.reduce((a, b) => a + b, 0) / ages.length / 1000 / 60 : 0;

    const stalePlatforms = markets.filter(m => {
      if (!m.lastUpdated) return true;
      const ageMinutes = (now - new Date(m.lastUpdated).getTime()) / 1000 / 60;
      return ageMinutes > 10;
    });

    const platformsWithOldData = markets
      .filter(m => {
        if (!m.lastUpdated) return true;
        const ageMinutes = (now - new Date(m.lastUpdated).getTime()) / 1000 / 60;
        return ageMinutes > 60;
      })
      .map(m => m.name);

    return {
      oldestDataAge,
      stalePlatformCount: stalePlatforms.length,
      averageDataAge,
      platformsWithOldData
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

  async getServerMetrics(): Promise<ServerMetrics> {
    const mem = process.memoryUsage();
    const cpus = os.cpus();
    const cpuUsage = cpus.reduce((acc, cpu) => {
      const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
      const idle = cpu.times.idle;
      return acc + (100 - (idle / total) * 100);
    }, 0) / cpus.length;

    return {
      uptime: process.uptime(),
      memoryUsage: {
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        rss: mem.rss,
        external: mem.external
      },
      cpuUsage,
      activeConnections: 0, // Would need tracking
      requestRate: null,
      errorRate: null
    };
  }

  async getConfiguration(): Promise<ConfigurationValues> {
    return {
      environment: env.NODE_ENV,
      port: env.PORT,
      features: {
        scheduler: env.ENABLE_SCHEDULER,
        websockets: env.ENABLE_WEBSOCKETS,
        telemetry: env.ENABLE_TELEMETRY
      },
      thresholds: {
        delegationAmountTRX: blockchainConfig.thresholds.delegationAmountTRX,
        stakeAmountTRX: blockchainConfig.thresholds.stakeAmountTRX
      },
      limits: {},
      integrations: {
        hasTronGridKey: !!env.TRONGRID_API_KEY,
        hasTelegramBot: !!env.TELEGRAM_BOT_TOKEN,
        hasStorageConfigured: !!(env.STORAGE_BUCKET && env.STORAGE_ACCESS_KEY_ID)
      }
    };
  }

}
