import type { Request, Response } from 'express';
import type { Redis as RedisClient } from 'ioredis';
import { z } from 'zod';
import { AccountService } from './account.service.js';

const snapshotSchema = z.object({
  address: z.string().min(34).max(35)
});

export class AccountController {
  private readonly service: AccountService;

  constructor(redis: RedisClient) {
    this.service = new AccountService(redis);
  }

  snapshot = async (req: Request, res: Response) => {
    const params = snapshotSchema.parse({ address: req.query.address });
    const snapshot = await this.service.getAccountSnapshot(params.address);
    res.json({ success: true, snapshot });
  };
}
