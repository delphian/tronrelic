import type { Request, Response, NextFunction } from 'express';
import { getRedisClient } from '../../loaders/redis.js';
import { RateLimitService } from '../../services/rate-limit.service.js';

const redis = () => getRedisClient();

export function createRateLimiter({ windowSeconds, maxRequests, keyPrefix }: { windowSeconds: number; maxRequests: number; keyPrefix: string; }) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const limiter = new RateLimitService(redis(), windowSeconds, maxRequests);
    const key = `${keyPrefix}:${req.ip}`;
    await limiter.consume(key);
    next();
  };
}
