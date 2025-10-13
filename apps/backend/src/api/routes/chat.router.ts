import { Router } from 'express';
import { getRedisClient } from '../../loaders/redis.js';
import { ChatController } from '../../modules/chat/chat.controller.js';
import { createRateLimiter } from '../middleware/rate-limit.js';

export function chatRouter() {
  const router = Router();
  const controller = new ChatController(getRedisClient());

  router.get('/', controller.list);
  router.post('/', createRateLimiter({ windowSeconds: 30, maxRequests: 2, keyPrefix: 'chat' }), controller.upsert);
  router.post('/ignore', createRateLimiter({ windowSeconds: 60, maxRequests: 10, keyPrefix: 'chat:ignore' }), controller.updateIgnore);
  router.get('/ignore', createRateLimiter({ windowSeconds: 60, maxRequests: 30, keyPrefix: 'chat:ignore:list' }), controller.listIgnore);

  return router;
}
