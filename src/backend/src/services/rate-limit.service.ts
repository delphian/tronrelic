import type { Redis as RedisClient } from 'ioredis';
import { RateLimitError } from '../lib/errors.js';

export class RateLimitService {
  constructor(private readonly redis: RedisClient, private readonly windowSeconds: number, private readonly maxRequests: number) {}

  async consume(key: string) {
    const redisKey = `ratelimit:${key}`;
    const requests = await this.redis.incr(redisKey);

    if (requests === 1) {
      await this.redis.expire(redisKey, this.windowSeconds);
    }

    if (requests > this.maxRequests) {
      throw new RateLimitError('Too many requests');
    }
  }
}
