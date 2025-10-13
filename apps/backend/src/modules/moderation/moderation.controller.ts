import type { Request, Response } from 'express';
import { z } from 'zod';
import { ModerationService } from './moderation.service.js';

const actionSchema = z.object({
  performedBy: z.string().min(1),
  reason: z.string().max(500).optional()
});

const muteSchema = actionSchema.extend({
  wallet: z.string().min(34),
  scope: z.enum(['comments', 'chat', 'all']),
  expiresAt: z.string().datetime().optional()
});

const unmuteSchema = z.object({
  wallet: z.string().min(34),
  scope: z.enum(['comments', 'chat', 'all']),
  performedBy: z.string().min(1)
});

const listMutesQuerySchema = z.object({
  scope: z.enum(['comments', 'chat', 'all']).optional()
});

const listIgnoreQuerySchema = z.object({
  wallet: z.string().min(34),
  scope: z.enum(['comments', 'chat', 'all']).optional()
});

const ignoreMutationSchema = z.object({
  ownerWallet: z.string().min(34),
  ignoredWallet: z.string().min(34),
  scope: z.enum(['comments', 'chat', 'all']),
  performedBy: z.string().min(1)
});

export class ModerationController {
  private readonly service = new ModerationService();

  spamQueue = async (_req: Request, res: Response) => {
    const queue = await this.service.listSpamQueue();
    res.json({ success: true, queue });
  };

  listMutes = async (req: Request, res: Response) => {
    const params = listMutesQuerySchema.parse(req.query);
    const mutes = await this.service.listMutes(params.scope);
    res.json({ success: true, mutes });
  };

  listIgnoreEntries = async (req: Request, res: Response) => {
    const params = listIgnoreQuerySchema.parse(req.query);
    const entries = await this.service.listIgnoreEntries(params.wallet, params.scope);
    res.json({ success: true, entries });
  };

  addIgnoreEntry = async (req: Request, res: Response) => {
    const body = ignoreMutationSchema.parse(req.body);
    await this.service.addIgnoreEntry(body.ownerWallet, body.ignoredWallet, body.scope, body.performedBy);
    res.status(201).json({ success: true });
  };

  removeIgnoreEntry = async (req: Request, res: Response) => {
    const body = ignoreMutationSchema.parse(req.body);
    await this.service.removeIgnoreEntry(body.ownerWallet, body.ignoredWallet, body.scope, body.performedBy);
    res.json({ success: true });
  };

  muteWallet = async (req: Request, res: Response) => {
    const body = muteSchema.parse(req.body);
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : undefined;
    await this.service.muteWallet(body.wallet, body.scope, body, expiresAt);
    res.status(201).json({ success: true });
  };

  unmuteWallet = async (req: Request, res: Response) => {
    const body = unmuteSchema.parse(req.body);
    await this.service.unmuteWallet(body.wallet, body.scope, body.performedBy);
    res.json({ success: true });
  };

  deleteComment = async (req: Request, res: Response) => {
    const params = actionSchema.parse(req.body);
    const comment = await this.service.deleteComment(req.params.commentId, params);
    res.json({ success: true, comment });
  };

  restoreComment = async (req: Request, res: Response) => {
    const params = actionSchema.parse(req.body);
    const comment = await this.service.restoreComment(req.params.commentId, params.performedBy);
    res.json({ success: true, comment });
  };

  flagCommentSpam = async (req: Request, res: Response) => {
    const params = actionSchema.parse(req.body);
    const comment = await this.service.flagCommentSpam(req.params.commentId, params);
    res.json({ success: true, comment });
  };

  unflagCommentSpam = async (req: Request, res: Response) => {
    const params = actionSchema.parse(req.body);
    const comment = await this.service.unflagCommentSpam(req.params.commentId, params.performedBy);
    res.json({ success: true, comment });
  };

  deleteChatMessage = async (req: Request, res: Response) => {
    const params = actionSchema.parse(req.body);
    const message = await this.service.deleteChatMessage(req.params.messageId, params);
    res.json({ success: true, message });
  };

  restoreChatMessage = async (req: Request, res: Response) => {
    const params = actionSchema.parse(req.body);
    const message = await this.service.restoreChatMessage(req.params.messageId, params.performedBy);
    res.json({ success: true, message });
  };

  flagChatSpam = async (req: Request, res: Response) => {
    const params = actionSchema.parse(req.body);
    const message = await this.service.flagChatSpam(req.params.messageId, params);
    res.json({ success: true, message });
  };

  unflagChatSpam = async (req: Request, res: Response) => {
    const params = actionSchema.parse(req.body);
    const message = await this.service.unflagChatSpam(req.params.messageId, params.performedBy);
    res.json({ success: true, message });
  };
}
