import type { Request, Response } from 'express';
import type { Redis as RedisClient } from 'ioredis';
import { SystemMonitorService } from './system-monitor.service.js';
import { BlockchainService } from '../blockchain/blockchain.service.js';
import { MarketService } from '../markets/market.service.js';
import { getScheduler } from '../../jobs/index.js';
import { BlockchainObserverService } from '../../services/blockchain-observer/index.js';
import { SystemConfigService } from '../../services/system-config/index.js';

export class SystemMonitorController {
  private readonly service: SystemMonitorService;

  constructor(redis: RedisClient) {
    this.service = new SystemMonitorService(redis);
  }

  getBlockchainStatus = async (_req: Request, res: Response) => {
    const status = await this.service.getBlockchainSyncStatus();
    res.json({ success: true, status });
  };

  getTransactionStats = async (_req: Request, res: Response) => {
    const stats = await this.service.getTransactionStats();
    res.json({ success: true, stats });
  };

  getBlockProcessingMetrics = async (_req: Request, res: Response) => {
    const metrics = await this.service.getBlockProcessingMetrics();
    res.json({ success: true, metrics });
  };

  triggerBlockchainSync = async (_req: Request, res: Response) => {
    const service = BlockchainService.getInstance();
    // Trigger sync asynchronously
    service.syncLatestBlocks().catch(err => {
      console.error('Manual blockchain sync failed:', err);
    });
    res.json({ success: true, message: 'Blockchain sync triggered' });
  };

  getSchedulerStatus = async (_req: Request, res: Response) => {
    const jobs = await this.service.getSchedulerStatus();
    res.json({ success: true, jobs });
  };

  getSchedulerHealth = async (_req: Request, res: Response) => {
    const health = await this.service.getSchedulerHealth();
    res.json({ success: true, health });
  };

  updateSchedulerJob = async (req: Request, res: Response) => {
    try {
      const { jobName } = req.params;
      const { schedule, enabled } = req.body;

      const scheduler = getScheduler();
      if (!scheduler) {
        return res.status(503).json({
          success: false,
          error: 'Scheduler is not enabled or not initialized'
        });
      }

      if (schedule !== undefined && typeof schedule !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Schedule must be a valid cron expression string'
        });
      }

      if (enabled !== undefined && typeof enabled !== 'boolean') {
        return res.status(400).json({
          success: false,
          error: 'Enabled must be a boolean'
        });
      }

      await scheduler.updateJobConfig(jobName, { schedule, enabled });

      res.json({
        success: true,
        message: `Scheduler job ${jobName} updated successfully`,
        job: scheduler.getJobConfig(jobName)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(400).json({
        success: false,
        error: message
      });
    }
  };

  getMarketPlatformStatus = async (_req: Request, res: Response) => {
    const platforms = await this.service.getMarketPlatformStatus();
    res.json({ success: true, platforms });
  };

  getMarketDataFreshness = async (_req: Request, res: Response) => {
    const freshness = await this.service.getMarketDataFreshness();
    res.json({ success: true, freshness });
  };

  triggerMarketRefresh = async (req: Request, res: Response) => {
    const marketService = new MarketService(req.app.locals.redis);
    const force = req.body?.force === true;

    // Trigger refresh asynchronously
    marketService.refreshMarkets(force).catch(err => {
      console.error('Manual market refresh failed:', err);
    });

    res.json({ success: true, message: 'Market refresh triggered' });
  };

  getDatabaseStatus = async (_req: Request, res: Response) => {
    const status = await this.service.getDatabaseStatus();
    res.json({ success: true, status });
  };

  getRedisStatus = async (_req: Request, res: Response) => {
    const status = await this.service.getRedisStatus();
    res.json({ success: true, status });
  };

  getServerMetrics = async (_req: Request, res: Response) => {
    const metrics = await this.service.getServerMetrics();
    res.json({ success: true, metrics });
  };

  getConfiguration = async (_req: Request, res: Response) => {
    const config = await this.service.getConfiguration();
    res.json({ success: true, config });
  };

  getSystemConfig = async (_req: Request, res: Response) => {
    const configService = SystemConfigService.getInstance();
    const config = await configService.getConfig();
    res.json({ success: true, config });
  };

  updateSystemConfig = async (req: Request, res: Response) => {
    const configService = SystemConfigService.getInstance();
    const { siteUrl, logLevel, systemLogsMaxCount, systemLogsRetentionDays } = req.body;

    // Build updates object with only provided fields
    const updates: any = {};

    if (siteUrl !== undefined) {
      // Validate URL format
      try {
        new URL(siteUrl);
        updates.siteUrl = siteUrl;
      } catch (err) {
        return res.status(400).json({
          success: false,
          error: 'Invalid URL format. Must include protocol (http:// or https://)'
        });
      }
    }

    if (logLevel !== undefined) {
      const validLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'];
      if (!validLevels.includes(logLevel)) {
        return res.status(400).json({
          success: false,
          error: `Invalid log level. Must be one of: ${validLevels.join(', ')}`
        });
      }
      updates.logLevel = logLevel;
    }

    if (systemLogsMaxCount !== undefined) {
      const count = Number(systemLogsMaxCount);
      if (isNaN(count) || count < 0) {
        return res.status(400).json({
          success: false,
          error: 'systemLogsMaxCount must be a non-negative number'
        });
      }
      updates.systemLogsMaxCount = count;
    }

    if (systemLogsRetentionDays !== undefined) {
      const days = Number(systemLogsRetentionDays);
      if (isNaN(days) || days < 0) {
        return res.status(400).json({
          success: false,
          error: 'systemLogsRetentionDays must be a non-negative number'
        });
      }
      updates.systemLogsRetentionDays = days;
    }

    // Require at least one field to update
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'At least one field must be provided (siteUrl, logLevel, systemLogsMaxCount, systemLogsRetentionDays)'
      });
    }

    const config = await configService.updateConfig(updates);

    // If log level was updated, apply it immediately to SystemLogService
    if (updates.logLevel !== undefined) {
      const { SystemLogService } = await import('../../services/system-log/system-log.service.js');
      const logService = SystemLogService.getInstance();
      await logService.applyLogLevelFromConfig();
    }

    res.json({ success: true, config });
  };

  getSystemOverview = async (_req: Request, res: Response) => {
    const [
      blockchainStatus,
      transactionStats,
      schedulerHealth,
      marketFreshness,
      databaseStatus,
      redisStatus,
      serverMetrics
    ] = await Promise.all([
      this.service.getBlockchainSyncStatus(),
      this.service.getTransactionStats(),
      this.service.getSchedulerHealth(),
      this.service.getMarketDataFreshness(),
      this.service.getDatabaseStatus(),
      this.service.getRedisStatus(),
      this.service.getServerMetrics()
    ]);

    res.json({
      success: true,
      overview: {
        blockchain: blockchainStatus,
        transactions: transactionStats,
        scheduler: schedulerHealth,
        markets: marketFreshness,
        database: databaseStatus,
        redis: redisStatus,
        server: serverMetrics
      }
    });
  };

  getObserverStats = async (_req: Request, res: Response) => {
    const service = BlockchainObserverService.getInstance();
    const observers = service.getAllObserverStats();
    res.json({ success: true, observers });
  };
}
