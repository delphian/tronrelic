import type { Request, Response } from 'express';
import type { Redis as RedisClient } from 'ioredis';
import { z } from 'zod';
import { ChatService } from './chat.service.js';

const upsertSchema = z.object({
  wallet: z.string().min(34),
  message: z.string().min(1).max(280),
  signature: z.string().min(1)
});

const listSchema = z.object({
  wallet: z.string().min(34).optional()
});

const ignoreSchema = z.object({
  wallet: z.string().min(34),
  targetWallet: z.string().min(34),
  action: z.enum(['add', 'remove']),
  message: z.string().min(1),
  signature: z.string().min(1)
});

const ignoreQuerySchema = z.object({
  wallet: z.string().min(34)
});

export class ChatController {
  private readonly service: ChatService;

  constructor(redis: RedisClient) {
    this.service = new ChatService(redis);
  }

  list = async (req: Request, res: Response) => {
    const params = listSchema.parse(req.query);
    const { messages, meta } = await this.service.list(params.wallet);
    res.json({ success: true, messages, meta });
  };

  upsert = async (req: Request, res: Response) => {
    const body = upsertSchema.parse(req.body);
    const result = await this.service.upsertMessage(body.wallet, body.message, body.signature);
    res.json({ success: true, message: result.message, meta: result.meta });
  };

  updateIgnore = async (req: Request, res: Response) => {
    const body = ignoreSchema.parse(req.body);
    const ignoreList = await this.service.updateIgnoreList(body.wallet, body.targetWallet, body.action, body.message, body.signature);
    res.json({ success: true, ignoreList });
  };

  listIgnore = async (req: Request, res: Response) => {
    const params = ignoreQuerySchema.parse(req.query);
    const ignoreList = await this.service.listIgnoreEntries(params.wallet);
    res.json({ success: true, ignoreList });
  };
}
