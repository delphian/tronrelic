import { Router } from 'express';
import type { IDatabaseService } from '@tronrelic/types';
import { getRedisClient } from '../../loaders/redis.js';
import { LiveController } from '../../modules/live/live.controller.js';

export function liveRouter(database: IDatabaseService) {
  const router = Router();
  const controller = new LiveController(getRedisClient(), database);

  router.post('/accounts/account-searches', controller.accountSearches);

  return router;
}
