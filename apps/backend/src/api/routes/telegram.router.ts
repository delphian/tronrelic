import { Router } from 'express';
import { TelegramController } from '../../modules/notifications/telegram.controller.js';

export function telegramRouter() {
  const router = Router();
  const controller = new TelegramController();

  router.post('/bot/webhook', controller.webhook);

  return router;
}
