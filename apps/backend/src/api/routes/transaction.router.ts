import { Router } from 'express';
import mongoose from 'mongoose';
import { getRedisClient } from '../../loaders/redis.js';
import { DatabaseService } from '../../modules/database/index.js';
import { TransactionController } from '../../modules/analytics/transaction.controller.js';
import { logger } from '../../lib/logger.js';

export function transactionRouter() {
  const router = Router();
  const database = new DatabaseService(logger.child({ module: 'transaction-router' }), mongoose.connection);
  const controller = new TransactionController(getRedisClient(), database);

  router.post('/', controller.singleTransaction);

  return router;
}
