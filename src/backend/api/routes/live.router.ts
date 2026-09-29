import { Router } from 'express';
import type { IDatabaseService } from '@/types';
import { getRedisClient } from '../../loaders/redis.js';
import { LiveController } from '../../modules/live/live.controller.js';
import { asyncHandler } from '../middleware/async-handler.js';

export function liveRouter(database: IDatabaseService) {
  const router = Router();
  const controller = new LiveController(getRedisClient(), database);

  // Express 4 does not catch a rejected promise from an async handler; the
  // wrapper forwards a database or cache failure to the error middleware
  // instead of leaving an unhandled rejection that terminates the process.
  router.post('/accounts/account-searches', asyncHandler(controller.accountSearches));

  return router;
}
