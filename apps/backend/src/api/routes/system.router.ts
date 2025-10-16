import { Router } from 'express';
import { requireAdmin } from '../middleware/admin-auth.js';
import { SystemMonitorController } from '../../modules/system/system-monitor.controller.js';
import { getRedisClient } from '../../loaders/redis.js';
import { PluginWebSocketRegistry } from '../../services/plugin-websocket-registry.js';

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

  return router;
}
