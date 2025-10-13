import type { Request, Response } from 'express';
import type { Redis as RedisClient } from 'ioredis';
import { LiveService } from './live.service.js';

export class LiveController {
  private readonly service: LiveService;

  constructor(redis: RedisClient) {
    this.service = new LiveService(redis);
  }

  accountSearches = async (_req: Request, res: Response) => {
    const accounts = await this.service.getAccountSearches();
    res.json({ success: true, accounts });
  };
}
