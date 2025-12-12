import { Router } from 'express';
import type { IDatabaseService } from '@tronrelic/types';
import { NotificationController } from '../../modules/notifications/notification.controller.js';

export function notificationsRouter(database: IDatabaseService) {
  const router = Router();
  const controller = new NotificationController(database);

  router.get('/preferences', controller.getPreferences);
  router.post('/preferences', controller.updatePreferences);

  return router;
}
