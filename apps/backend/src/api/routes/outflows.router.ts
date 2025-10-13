import { Router } from 'express';
import { getRedisClient } from '../../loaders/redis.js';
import { FlowAnalyticsService } from '../../modules/analytics/flow-analytics.service.js';
import { FlowController } from '../../modules/analytics/flow.controller.js';

export function outflowsRouter() {
  const router = Router();
  const service = new FlowAnalyticsService(getRedisClient());
  const controller = new FlowController(service, 'outflow');

  router.post('/account-outflow-totals', controller.totals);
  router.post('/account-outflow-address-chunked-date', controller.series);

  return router;
}
