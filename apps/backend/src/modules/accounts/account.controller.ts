import type { Request, Response } from 'express';
import type { Redis as RedisClient } from 'ioredis';
import { z } from 'zod';
import { AccountService } from './account.service.js';
import { BookmarkService, type BookmarkPayload } from './bookmark.service.js';

const walletSchema = z.string().min(34).max(35);

const bookmarkSchema = z.object({
  ownerWallet: walletSchema,
  targetWallet: walletSchema,
  label: z.string().max(140).optional(),
  message: z.string().min(8),
  signature: z.string().min(8)
});

const snapshotSchema = z.object({
  address: z.string().min(34).max(35)
});

export class AccountController {
  private readonly service: AccountService;
  private readonly bookmarks: BookmarkService;

  constructor(redis: RedisClient) {
    this.service = new AccountService(redis);
    this.bookmarks = new BookmarkService(redis);
  }

  snapshot = async (req: Request, res: Response) => {
    const params = snapshotSchema.parse({ address: req.query.address });
    const snapshot = await this.service.getAccountSnapshot(params.address);
    res.json({ success: true, snapshot });
  };

  listBookmarks = async (req: Request, res: Response) => {
    const wallet = walletSchema.parse(req.query.wallet);
    const bookmarks = await this.bookmarks.list(wallet);
    res.json({ success: true, bookmarks });
  };

  upsertBookmark = async (req: Request, res: Response) => {
    const payload = bookmarkSchema.parse(req.body) as BookmarkPayload;
    const bookmarks = await this.bookmarks.upsert(payload);
    res.json({ success: true, bookmarks });
  };

  deleteBookmark = async (req: Request, res: Response) => {
    const payload = bookmarkSchema.parse(req.body) as BookmarkPayload;
    const bookmarks = await this.bookmarks.remove(payload);
    res.json({ success: true, bookmarks });
  };
}
