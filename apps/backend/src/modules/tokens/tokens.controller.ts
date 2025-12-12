import type { Request, Response } from 'express';
import type { Redis as RedisClient } from 'ioredis';
import type { IDatabaseService } from '@tronrelic/types';
import { z } from 'zod';
import { TokensService } from './tokens.service.js';

const sunPumpSchema = z.object({
  limit: z.coerce.number().min(1).max(200).default(10)
});

export class TokensController {
  private readonly service: TokensService;

  constructor(redis: RedisClient, database: IDatabaseService) {
    this.service = new TokensService(redis, database);
  }

  sunpumpRecent = async (req: Request, res: Response) => {
    const payload = sunPumpSchema.parse(req.body ?? {});
    const result = await this.service.getRecentSunPumpTokens(payload.limit);
    res.json({ success: true, cache: result.cache, tokens: result.tokens });
  };
}
