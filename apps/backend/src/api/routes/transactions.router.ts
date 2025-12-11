import { Router } from 'express';
import mongoose from 'mongoose';
import { TransactionController } from '../../modules/analytics/transaction.controller.js';
import { getRedisClient } from '../../loaders/redis.js';
import { DatabaseService } from '../../modules/database/index.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { createRateLimiter } from '../middleware/rate-limit.js';
import { logger } from '../../lib/logger.js';

export function transactionsRouter() {
  const router = Router();
  const database = new DatabaseService(logger.child({ module: 'transactions-router' }), mongoose.connection);
  const controller = new TransactionController(getRedisClient(), database);

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
