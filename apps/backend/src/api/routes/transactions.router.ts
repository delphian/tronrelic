import { Router } from 'express';
import { TransactionController } from '../../modules/analytics/transaction.controller.js';
import { getRedisClient } from '../../loaders/redis.js';

export function transactionsRouter() {
  const router = Router();
  const controller = new TransactionController(getRedisClient());

  router.post('/high-amounts', controller.highAmounts);
  router.post('/account', controller.accountTransactions);
  router.post('/account-recent', controller.accountRecent);
  router.post('/account-date-range', controller.accountDateRange);
  router.post('/ids', controller.transactionsByIds);
  router.post('/latest-by-type', controller.latestByType);
  router.post('/memo/memo-recent', controller.memoRecent);

  return router;
}
