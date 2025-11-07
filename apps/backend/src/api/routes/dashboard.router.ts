import { Router } from 'express';
import { DashboardController } from '../../modules/dashboard/dashboard.controller.js';

export function dashboardRouter() {
  const router = Router();
  const controller = new DashboardController();

  router.get('/delegations/timeseries', controller.delegationTimeseries);
  router.get('/staking/timeseries', controller.stakingTimeseries);
  router.get('/memos/feed', controller.memoFeed);

  return router;
}
