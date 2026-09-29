import { Router } from 'express';
import type { IDatabaseService } from '@/types';
import { getRedisClient } from '../../loaders/redis.js';
import { FlowAnalyticsService } from '../../modules/analytics/flow-analytics.service.js';
import { FlowController } from '../../modules/analytics/flow.controller.js';
import { asyncHandler } from '../middleware/async-handler.js';

export function inflowsRouter(database: IDatabaseService) {
  const router = Router();
  const service = new FlowAnalyticsService(getRedisClient(), database);
  const controller = new FlowController(service, 'inflow');

  // Express 4 does not catch a rejected promise from an async handler, and the
  // controller's zod parse throws on a malformed body. Unwrapped, one bad
  // request became an unhandled rejection that terminated the process.
  router.post('/account-inflow-totals', asyncHandler(controller.totals));
  router.post('/account-inflow-address-chunked-date', asyncHandler(controller.series));

  return router;
}
