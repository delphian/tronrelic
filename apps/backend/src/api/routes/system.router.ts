import { Router } from 'express';
import { requireAdmin } from '../middleware/admin-auth.js';
import { SystemMonitorController } from '../../modules/system/system-monitor.controller.js';
import { getRedisClient } from '../../loaders/redis.js';
import { PluginWebSocketRegistry } from '../../services/plugin-websocket-registry.js';
import { SystemLogsService } from '../../services/system-logs/index.js';
import type { LogLevel } from '../../database/models/SystemLog.js';

export function systemRouter() {
  const router = Router();
  const controller = new SystemMonitorController(getRedisClient());
  const wsRegistry = PluginWebSocketRegistry.getInstance();

  router.use(requireAdmin);

  // Overview endpoint
  router.get('/overview', controller.getSystemOverview);

  // Blockchain endpoints
  router.get('/blockchain/status', controller.getBlockchainStatus);
  router.get('/blockchain/transactions', controller.getTransactionStats);
  router.get('/blockchain/metrics', controller.getBlockProcessingMetrics);
  router.get('/blockchain/observers', controller.getObserverStats);
  router.post('/blockchain/sync', controller.triggerBlockchainSync);

  // Scheduler endpoints
  router.get('/scheduler/status', controller.getSchedulerStatus);
  router.get('/scheduler/health', controller.getSchedulerHealth);
  router.patch('/scheduler/job/:jobName', controller.updateSchedulerJob);

  // Market endpoints
  router.get('/markets/platforms', controller.getMarketPlatformStatus);
  router.get('/markets/freshness', controller.getMarketDataFreshness);
  router.post('/markets/refresh', controller.triggerMarketRefresh);

  // System health endpoints
  router.get('/health/database', controller.getDatabaseStatus);
  router.get('/health/redis', controller.getRedisStatus);
  router.get('/health/server', controller.getServerMetrics);

  // Configuration endpoints
  router.get('/config', controller.getConfiguration);
  router.get('/config/system', controller.getSystemConfig);
  router.patch('/config/system', controller.updateSystemConfig);

  // Plugin WebSocket monitoring endpoints
  router.get('/websockets/stats', async (req, res, next) => {
    try {
      const stats = await wsRegistry.getAllPluginStats();
      res.json({ success: true, stats });
    } catch (error) {
      next(error);
    }
  });

  router.get('/websockets/aggregate', async (req, res, next) => {
    try {
      const aggregate = await wsRegistry.getAggregateStats();
      res.json({ success: true, aggregate });
    } catch (error) {
      next(error);
    }
  });

  router.get('/websockets/plugin/:pluginId', async (req, res, next) => {
    try {
      const { pluginId } = req.params;
      const stats = await wsRegistry.getPluginStats(pluginId);

      if (!stats) {
        return res.status(404).json({
          success: false,
          error: `Plugin ${pluginId} not found or does not have WebSocket capabilities`
        });
      }

      res.json({ success: true, stats });
    } catch (error) {
      next(error);
    }
  });

    // System logs endpoints
    const systemLogsService = SystemLogsService.getInstance();

    // Get paginated logs with optional filtering
    router.get('/logs', async (req, res, next) => {
        try {
            const {
                levels,
                service,
                resolved,
                startDate,
                endDate,
                page,
                limit
            } = req.query;

            // Parse query parameters
            const query: any = {};

            if (levels) {
                query.levels = Array.isArray(levels) ? levels as LogLevel[] : [levels as LogLevel];
            }

            if (service) {
                query.service = service as string;
            }

            if (resolved !== undefined) {
                query.resolved = resolved === 'true';
            }

            if (startDate) {
                query.startDate = new Date(startDate as string);
            }

            if (endDate) {
                query.endDate = new Date(endDate as string);
            }

            if (page) {
                query.page = parseInt(page as string, 10);
            }

            if (limit) {
                query.limit = parseInt(limit as string, 10);
            }

            const result = await systemLogsService.getLogs(query);

            res.json({
                success: true,
                ...result
            });
        } catch (error) {
            next(error);
        }
    });

    // Get log statistics
    router.get('/logs/stats', async (req, res, next) => {
        try {
            const stats = await systemLogsService.getStats();
            res.json({ success: true, stats });
        } catch (error) {
            next(error);
        }
    });

    // Get a single log entry by ID
    router.get('/logs/:id', async (req, res, next) => {
        try {
            const { id } = req.params;
            const log = await systemLogsService.getLogById(id);

            if (!log) {
                return res.status(404).json({
                    success: false,
                    error: 'Log entry not found'
                });
            }

            res.json({ success: true, log });
        } catch (error) {
            next(error);
        }
    });

    // Mark log as resolved
    router.patch('/logs/:id/resolve', async (req, res, next) => {
        try {
            const { id } = req.params;
            const { resolvedBy } = req.body;

            const log = await systemLogsService.markAsResolved(id, resolvedBy);

            if (!log) {
                return res.status(404).json({
                    success: false,
                    error: 'Log entry not found'
                });
            }

            res.json({ success: true, log });
        } catch (error) {
            next(error);
        }
    });

    // Mark log as unresolved
    router.patch('/logs/:id/unresolve', async (req, res, next) => {
        try {
            const { id } = req.params;
            const log = await systemLogsService.markAsUnresolved(id);

            if (!log) {
                return res.status(404).json({
                    success: false,
                    error: 'Log entry not found'
                });
            }

            res.json({ success: true, log });
        } catch (error) {
            next(error);
        }
    });

    // Clear all logs
    router.delete('/logs', async (req, res, next) => {
        try {
            const deletedCount = await systemLogsService.deleteAllLogs();
            res.json({
                success: true,
                message: `Deleted ${deletedCount} log entries`,
                deletedCount
            });
        } catch (error) {
            next(error);
        }
    });

  return router;
}
