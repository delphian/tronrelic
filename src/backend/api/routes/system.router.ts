import { Router } from 'express';
import type { IDatabaseService } from '@/types';
import { requireAdmin } from '../middleware/admin-auth.js';
import { createGroupedAdminRateLimiter } from '../middleware/rate-limit.js';
import { SystemMonitorController } from '../../modules/system/system-monitor.controller.js';
import { getRedisClient } from '../../loaders/redis.js';
import { PluginWebSocketRegistry } from '../../services/plugin-websocket-registry.js';
import { createSystemLogRouter } from '../../modules/logs/index.js';

export function systemRouter(database: IDatabaseService) {
  const router = Router();
  const controller = new SystemMonitorController(getRedisClient(), database);
  const wsRegistry = PluginWebSocketRegistry.getInstance();

  // One rate-limit bucket per endpoint group rather than a single bucket for
  // the whole router. The /system/system dashboard polls this router from one
  // IP continuously — the telemetry strip alone issues 7 requests every 15s,
  // and the Blockchain and Server consoles add 6 more every 10s — well past
  // the 60-per-minute admin allowance for a shared bucket. Bursts align every
  // 30s, so that bucket intermittently exhausted and answered 429 to whichever
  // requests arrived last, usually the blockchain trio. Splitting holds
  // blockchain near 26/min and health near 34/min, each against its own
  // 60/min ceiling. Health carries the larger share because ServerSection
  // polls three probes rather than two — `/health/infrastructure` joined
  // redis and server when the console started reporting droplet and
  // per-container metrics. `/config` and anything added later fall through to
  // the `system-monitor` default.
  router.use(createGroupedAdminRateLimiter(
    {
      blockchain: 'system-blockchain',
      health: 'system-health',
      websockets: 'system-websockets',
      logs: 'system-logs'
    },
    'system-monitor'
  ));
  router.use(requireAdmin);

  // Blockchain endpoints
  router.get('/blockchain/status', controller.getBlockchainStatus);
  router.get('/blockchain/transactions', controller.getTransactionStats);
  router.get('/blockchain/metrics', controller.getBlockProcessingMetrics);
  router.get('/blockchain/observers', controller.getObserverStats);
  router.post('/blockchain/sync', controller.triggerBlockchainSync);

  // The transaction-detail AI tool's usage/rate-limit stats moved to the core
  // AI tools governance surface (audit feed + policy counters) under
  // /api/admin/system/ai-tools — the bespoke endpoint here was retired with
  // TransactionToolGuard when the core governor took over rate limiting.

  // Scheduler endpoints moved to SchedulerModule (/api/admin/system/scheduler/*)

  // System health endpoints
  router.get('/health/database', controller.getDatabaseStatus);
  router.get('/health/clickhouse', controller.getClickHouseStatus);
  router.get('/health/redis', controller.getRedisStatus);
  router.get('/health/server', controller.getServerMetrics);
  router.get('/health/infrastructure', controller.getInfrastructureStatus);

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

  // System logs endpoints (delegated to dedicated log router)
  router.use('/logs', createSystemLogRouter());

  return router;
}
