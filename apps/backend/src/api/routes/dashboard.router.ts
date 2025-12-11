import { Router } from 'express';
import type { IDatabaseService } from '@tronrelic/types';
import { DashboardController } from '../../modules/dashboard/dashboard.controller.js';

export function dashboardRouter(database: IDatabaseService) {
  const router = Router();
  const controller = new DashboardController(database);

  router.get('/delegations/timeseries', controller.delegationTimeseries);
  router.get('/staking/timeseries', controller.stakingTimeseries);
  router.get('/memos/feed', controller.memoFeed);

  return router;
}
