import { Router } from 'express';
import type { IDatabaseService } from '@tronrelic/types';
import { getRedisClient } from '../../loaders/redis.js';
import { AccountController } from '../../modules/accounts/account.controller.js';

export function accountsRouter(database: IDatabaseService) {
  const router = Router();
  const controller = new AccountController(getRedisClient(), database);

  router.get('/snapshot', controller.snapshot);

  return router;
}
