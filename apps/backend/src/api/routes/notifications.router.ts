import { Router } from 'express';
import mongoose from 'mongoose';
import { NotificationController } from '../../modules/notifications/notification.controller.js';
import { DatabaseService } from '../../modules/database/index.js';
import { logger } from '../../lib/logger.js';

export function notificationsRouter() {
  const router = Router();
  const database = new DatabaseService(logger.child({ module: 'notifications-router' }), mongoose.connection);
  const controller = new NotificationController(database);

  router.get('/preferences', controller.getPreferences);
  router.post('/preferences', controller.updatePreferences);

  return router;
}
