import { Router } from 'express';
import mongoose from 'mongoose';
import { getRedisClient } from '../../loaders/redis.js';
import { DatabaseService } from '../../modules/database/index.js';
import { LiveController } from '../../modules/live/live.controller.js';
import { logger } from '../../lib/logger.js';

export function liveRouter() {
  const router = Router();
  const database = new DatabaseService(logger.child({ module: 'live-router' }), mongoose.connection);
  const controller = new LiveController(getRedisClient(), database);

  router.post('/accounts/account-searches', controller.accountSearches);

  return router;
}
