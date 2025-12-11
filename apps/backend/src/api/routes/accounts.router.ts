import { Router } from 'express';
import mongoose from 'mongoose';
import { getRedisClient } from '../../loaders/redis.js';
import { DatabaseService } from '../../modules/database/index.js';
import { AccountController } from '../../modules/accounts/account.controller.js';
import { logger } from '../../lib/logger.js';

export function accountsRouter() {
  const router = Router();
  const database = new DatabaseService(logger.child({ module: 'accounts-router' }), mongoose.connection);
  const controller = new AccountController(getRedisClient(), database);

  router.get('/snapshot', controller.snapshot);

  return router;
}
