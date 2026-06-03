import { Router } from 'express';
import type { IDatabaseService, IServiceRegistry } from '@/types';
import { NotificationController } from '../../modules/notifications/notification.controller.js';
import { createRateLimiter } from '../middleware/rate-limit.js';

/**
 * Build the notification-preferences router.
 *
 * The controller authenticates each request off the Better Auth session and
 * verifies the requested wallet is linked to the caller via the `'wallets'`
 * service, so the registry is injected alongside the database. A per-IP rate
 * limiter (60s/30) sits in front — preference writes are infrequent, so a tight
 * ceiling bounds abuse against the ownership-check path.
 *
 * @param database - Shared database service instance.
 * @param serviceRegistry - Registry used to resolve the `'wallets'` service.
 * @returns Express router to mount at `/api/notifications`.
 */
export function notificationsRouter(database: IDatabaseService, serviceRegistry: IServiceRegistry) {
  const router = Router();
  const controller = new NotificationController(database, serviceRegistry);

  const rateLimiter = createRateLimiter({
    windowSeconds: 60,
    maxRequests: 30,
    keyPrefix: 'notifications:preferences'
  });

  router.get('/preferences', rateLimiter, controller.getPreferences);
  router.post('/preferences', rateLimiter, controller.updatePreferences);

  return router;
}
