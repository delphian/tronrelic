import { Router } from 'express';
import { getRedisClient } from '../../loaders/redis.js';
import { MarketController } from '../../modules/markets/market.controller.js';

export function marketsRouter() {
  const router = Router();
  const controller = new MarketController(getRedisClient());

  router.get('/compare', controller.compare);
  router.get('/', controller.list);
  router.post('/refresh', controller.refresh);
  router.get('/:guid/history', controller.history);
  router.post('/:guid/affiliate/impression', controller.affiliateImpression);
  router.post('/:guid/affiliate/click', controller.affiliateClick);

  return router;
}
