import type { Request, Response } from 'express';
import type { Redis as RedisClient } from 'ioredis';
import { z } from 'zod';
import { CommentService } from './comment.service.js';

const listSchema = z.object({
  threadId: z.string().min(1),
  wallet: z.string().min(34).optional()
});

const createSchema = z.object({
  threadId: z.string().min(1),
  wallet: z.string().min(34),
  message: z.string().min(1).max(500),
  signature: z.string().min(1),
  attachments: z
    .array(
      z.object({
        attachmentId: z.string().min(1),
        filename: z.string().min(1),
        storageKey: z.string().min(1),
        contentType: z.string().min(1),
        size: z.number().int().positive()
      })
    )
    .max(5)
    .optional()
});

const attachmentSchema = z.object({
  wallet: z.string().min(34),
  filename: z.string().min(1),
  contentType: z.string().min(1),
  size: z.number().int().positive(),
  message: z.string().min(1),
  signature: z.string().min(1)
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

export class CommentController {
  private readonly service: CommentService;

  constructor(redis: RedisClient) {
    this.service = new CommentService(redis);
  }

  list = async (req: Request, res: Response) => {
    const params = listSchema.parse(req.query);
    const { comments, meta } = await this.service.list(params.threadId, params.wallet);
    res.json({ success: true, comments, meta });
  };

  create = async (req: Request, res: Response) => {
    const body = createSchema.parse(req.body);
    const result = await this.service.addComment(body.threadId, body.wallet, body.message, body.signature, {
      ip: req.ip,
      userAgent: req.get('user-agent') ?? undefined
    }, body.attachments);
    res.status(201).json({ success: true, comment: result.comment, meta: result.meta });
  };

  createAttachment = async (req: Request, res: Response) => {
    const body = attachmentSchema.parse(req.body);
    const attachment = await this.service.createAttachmentRequest(body.wallet, body.filename, body.contentType, body.size, body.message, body.signature);
    res.status(201).json({ success: true, attachment });
  };

  updateIgnore = async (req: Request, res: Response) => {
    const body = ignoreSchema.parse(req.body);
    const ignoreList = await this.service.updateIgnoreList(body.wallet, body.targetWallet, body.action, body.message, body.signature);
    res.status(200).json({ success: true, ignoreList });
  };

  listIgnore = async (req: Request, res: Response) => {
    const params = ignoreQuerySchema.parse(req.query);
    const ignoreList = await this.service.listIgnoreEntries(params.wallet);
    res.status(200).json({ success: true, ignoreList });
  };
}
