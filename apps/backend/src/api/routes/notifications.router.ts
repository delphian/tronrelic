import { Router } from 'express';
import { NotificationController } from '../../modules/notifications/notification.controller.js';

export function notificationsRouter() {
  const router = Router();
  const controller = new NotificationController();

  router.get('/preferences', controller.getPreferences);
  router.post('/preferences', controller.updatePreferences);

  return router;
}
