import { Router } from 'express';
import type { IDatabaseService } from '@/types';
import { getRedisClient } from '../../loaders/redis.js';
import { TransactionController } from '../../modules/analytics/transaction.controller.js';
import { asyncHandler } from '../middleware/async-handler.js';

export function transactionRouter(database: IDatabaseService) {
  const router = Router();
  const controller = new TransactionController(getRedisClient(), database);

  // Express 4 does not catch a rejected promise from an async handler, and the
  // controller's zod parse throws on a malformed body. Unwrapped, one bad
  // request became an unhandled rejection that terminated the process.
  router.post('/', asyncHandler(controller.singleTransaction));

  return router;
}
