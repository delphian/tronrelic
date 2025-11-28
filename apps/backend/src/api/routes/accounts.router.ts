import { Router } from 'express';
import { getRedisClient } from '../../loaders/redis.js';
import { AccountController } from '../../modules/accounts/account.controller.js';

export function accountsRouter() {
  const router = Router();
  const controller = new AccountController(getRedisClient());

  router.get('/snapshot', controller.snapshot);

  return router;
}
