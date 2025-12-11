import { Router } from 'express';
import mongoose from 'mongoose';
import { getRedisClient } from '../../loaders/redis.js';
import { DatabaseService } from '../../modules/database/index.js';
import { FlowAnalyticsService } from '../../modules/analytics/flow-analytics.service.js';
import { FlowController } from '../../modules/analytics/flow.controller.js';
import { logger } from '../../lib/logger.js';

export function inflowsRouter() {
  const router = Router();
  const database = new DatabaseService(logger.child({ module: 'inflows-router' }), mongoose.connection);
  const service = new FlowAnalyticsService(getRedisClient(), database);
  const controller = new FlowController(service, 'inflow');

  router.post('/account-inflow-totals', controller.totals);
  router.post('/account-inflow-address-chunked-date', controller.series);

  return router;
}
