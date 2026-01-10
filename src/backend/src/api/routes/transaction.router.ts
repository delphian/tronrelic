import { Router } from 'express';
import type { IDatabaseService } from '@/types';
import { getRedisClient } from '../../loaders/redis.js';
import { TransactionController } from '../../modules/analytics/transaction.controller.js';

export function transactionRouter(database: IDatabaseService) {
  const router = Router();
  const controller = new TransactionController(getRedisClient(), database);

  router.post('/', controller.singleTransaction);

  return router;
}
