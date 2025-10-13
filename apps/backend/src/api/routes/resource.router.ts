import { Router } from 'express';
import { getRedisClient } from '../../loaders/redis.js';
import { MarketResourceController } from '../../modules/markets/market-resource.controller.js';

export function resourceRouter() {
  const router = Router();
  const controller = new MarketResourceController(getRedisClient());

  router.post('/market/billing-recent', controller.billingRecent);
  router.post('/market/billing-totals', controller.billingTotals);

  return router;
}
