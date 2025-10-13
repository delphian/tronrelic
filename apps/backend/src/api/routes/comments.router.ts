import { Router } from 'express';
import { getRedisClient } from '../../loaders/redis.js';
import { CommentController } from '../../modules/comments/comment.controller.js';
import { createRateLimiter } from '../middleware/rate-limit.js';

export function commentsRouter() {
  const router = Router();
  const controller = new CommentController(getRedisClient());

  router.get('/', controller.list);
  router.post('/', createRateLimiter({ windowSeconds: 60, maxRequests: 3, keyPrefix: 'comments' }), controller.create);
  router.post('/attachments', createRateLimiter({ windowSeconds: 60, maxRequests: 10, keyPrefix: 'comments:attachments' }), controller.createAttachment);
  router.post('/ignore', createRateLimiter({ windowSeconds: 60, maxRequests: 10, keyPrefix: 'comments:ignore' }), controller.updateIgnore);
  router.get('/ignore', createRateLimiter({ windowSeconds: 60, maxRequests: 30, keyPrefix: 'comments:ignore:list' }), controller.listIgnore);

  return router;
}
