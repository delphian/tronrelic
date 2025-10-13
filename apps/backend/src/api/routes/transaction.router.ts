import { Router } from 'express';
import { getRedisClient } from '../../loaders/redis.js';
import { TransactionController } from '../../modules/analytics/transaction.controller.js';

export function transactionRouter() {
  const router = Router();
  const controller = new TransactionController(getRedisClient());

  router.post('/', controller.singleTransaction);

  return router;
}
