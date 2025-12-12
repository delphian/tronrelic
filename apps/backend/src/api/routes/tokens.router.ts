import { Router } from 'express';
import type { IDatabaseService } from '@tronrelic/types';
import { getRedisClient } from '../../loaders/redis.js';
import { TokensController } from '../../modules/tokens/tokens.controller.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { createRateLimiter } from '../middleware/rate-limit.js';

export function tokensRouter(database: IDatabaseService) {
  const router = Router();
  const controller = new TokensController(getRedisClient(), database);

  const rateLimiter = createRateLimiter({
    windowSeconds: 60,
    maxRequests: 60,
    keyPrefix: 'tokens'
  });

  router.post('/sunpump-recent', rateLimiter, asyncHandler(controller.sunpumpRecent));

  return router;
}
