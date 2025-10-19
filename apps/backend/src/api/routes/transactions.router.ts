import { Router } from 'express';
import { TransactionController } from '../../modules/analytics/transaction.controller.js';
import { getRedisClient } from '../../loaders/redis.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { createRateLimiter } from '../middleware/rate-limit.js';

export function transactionsRouter() {
  const router = Router();
  const controller = new TransactionController(getRedisClient());

  // Rate limiting for public endpoints (60 requests per minute per IP)
  const rateLimiter = createRateLimiter({
    windowSeconds: 60,
    maxRequests: 60,
    keyPrefix: 'transactions'
  });

  router.post('/high-amounts', rateLimiter, asyncHandler(controller.highAmounts));
  router.post('/account', rateLimiter, asyncHandler(controller.accountTransactions));
  router.post('/account-recent', rateLimiter, asyncHandler(controller.accountRecent));
  router.post('/account-date-range', rateLimiter, asyncHandler(controller.accountDateRange));
  router.post('/ids', rateLimiter, asyncHandler(controller.transactionsByIds));
  router.post('/latest-by-type', rateLimiter, asyncHandler(controller.latestByType));
  router.post('/memo/memo-recent', rateLimiter, asyncHandler(controller.memoRecent));

  return router;
}
