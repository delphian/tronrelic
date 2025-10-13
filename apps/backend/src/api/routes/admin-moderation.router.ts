import { Router } from 'express';
import { requireAdmin } from '../middleware/admin-auth.js';
import { ModerationController } from '../../modules/moderation/moderation.controller.js';

export function adminModerationRouter() {
  const router = Router();
  const controller = new ModerationController();

  router.use(requireAdmin);

  router.get('/spam-queue', controller.spamQueue);
  router.get('/mutes', controller.listMutes);
  router.get('/ignore', controller.listIgnoreEntries);

  router.post('/mutes', controller.muteWallet);
  router.delete('/mutes', controller.unmuteWallet);
  router.post('/ignore', controller.addIgnoreEntry);
  router.delete('/ignore', controller.removeIgnoreEntry);

  router.post('/comments/:commentId/delete', controller.deleteComment);
  router.post('/comments/:commentId/restore', controller.restoreComment);
  router.post('/comments/:commentId/spam', controller.flagCommentSpam);
  router.post('/comments/:commentId/unspam', controller.unflagCommentSpam);

  router.post('/chat/:messageId/delete', controller.deleteChatMessage);
  router.post('/chat/:messageId/restore', controller.restoreChatMessage);
  router.post('/chat/:messageId/spam', controller.flagChatSpam);
  router.post('/chat/:messageId/unspam', controller.unflagChatSpam);

  return router;
}
