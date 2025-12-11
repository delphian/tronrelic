import { Router } from 'express';
import mongoose from 'mongoose';
import { getRedisClient } from '../../loaders/redis.js';
import { DatabaseService } from '../../modules/database/index.js';
import { TokensController } from '../../modules/tokens/tokens.controller.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { createRateLimiter } from '../middleware/rate-limit.js';
import { logger } from '../../lib/logger.js';

export function tokensRouter() {
  const router = Router();
  const database = new DatabaseService(logger.child({ module: 'tokens-router' }), mongoose.connection);
  const controller = new TokensController(getRedisClient(), database);

  const rateLimiter = createRateLimiter({
    windowSeconds: 60,
    maxRequests: 60,
    keyPrefix: 'tokens'
  });

  router.post('/sunpump-recent', rateLimiter, asyncHandler(controller.sunpumpRecent));

  return router;
}
