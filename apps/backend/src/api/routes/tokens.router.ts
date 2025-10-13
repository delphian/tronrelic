import { Router } from 'express';
import { getRedisClient } from '../../loaders/redis.js';
import { TokensController } from '../../modules/tokens/tokens.controller.js';

export function tokensRouter() {
  const router = Router();
  const controller = new TokensController(getRedisClient());

  router.post('/sunpump-recent', controller.sunpumpRecent);

  return router;
}
