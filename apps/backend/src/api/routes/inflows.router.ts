import { Router } from 'express';
import type { IDatabaseService } from '@tronrelic/types';
import { getRedisClient } from '../../loaders/redis.js';
import { FlowAnalyticsService } from '../../modules/analytics/flow-analytics.service.js';
import { FlowController } from '../../modules/analytics/flow.controller.js';

export function inflowsRouter(database: IDatabaseService) {
  const router = Router();
  const service = new FlowAnalyticsService(getRedisClient(), database);
  const controller = new FlowController(service, 'inflow');

  router.post('/account-inflow-totals', controller.totals);
  router.post('/account-inflow-address-chunked-date', controller.series);

  return router;
}
