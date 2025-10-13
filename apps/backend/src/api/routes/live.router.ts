import { Router } from 'express';
import { getRedisClient } from '../../loaders/redis.js';
import { LiveController } from '../../modules/live/live.controller.js';

export function liveRouter() {
  const router = Router();
  const controller = new LiveController(getRedisClient());

  router.post('/accounts/account-searches', controller.accountSearches);

  return router;
}
