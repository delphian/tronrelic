import { Router } from 'express';
import mongoose from 'mongoose';
import { DashboardController } from '../../modules/dashboard/dashboard.controller.js';
import { DatabaseService } from '../../modules/database/index.js';
import { logger } from '../../lib/logger.js';

export function dashboardRouter() {
  const router = Router();
  const database = new DatabaseService(logger.child({ module: 'dashboard-router' }), mongoose.connection);
  const controller = new DashboardController(database);

  router.get('/delegations/timeseries', controller.delegationTimeseries);
  router.get('/staking/timeseries', controller.stakingTimeseries);
  router.get('/memos/feed', controller.memoFeed);

  return router;
}
