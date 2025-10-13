import { Router } from 'express';
import { getRedisClient } from '../../loaders/redis.js';
import { requireAdmin } from '../middleware/admin-auth.js';
import { MarketAdminController } from '../../modules/markets/market-admin.controller.js';

export function adminMarketsRouter() {
  const router = Router();
  const controller = new MarketAdminController(getRedisClient());

  router.use(requireAdmin);

  router.get('/', controller.list);
  router.patch('/:guid/priority', controller.updatePriority);
  router.patch('/:guid/status', controller.updateStatus);
  router.patch('/:guid/affiliate', controller.updateAffiliate);
  router.post('/:guid/refresh', controller.refresh);

  return router;
}
