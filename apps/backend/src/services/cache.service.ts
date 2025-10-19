import type { Redis as RedisClient } from 'ioredis';
import type { ICacheService } from '@tronrelic/types';
import { CacheModel, type CacheDoc } from '../database/models/cache-model.js';
import { logger } from '../lib/logger.js';

export class CacheService implements ICacheService {
  constructor(private readonly redis: RedisClient) {}

  async get<T>(key: string): Promise<T | null> {
    const cached = await this.redis.get(key);
    if (cached) {
      return JSON.parse(cached) as T;
    }

    const doc = await CacheModel.findOne({ key });
    if (!doc) {
      return null;
    }

    if (doc.expiresAt && doc.expiresAt < new Date()) {
      return null;
    }

    await this.redis.set(key, JSON.stringify(doc.value), 'EX', this.getTtlSeconds(doc));
    return doc.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number, tags?: string[]) {
    const payload: Partial<CacheDoc<T>> = {
      value,
      tags,
      expiresAt: ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000) : undefined
    };

    await CacheModel.updateOne({ key }, payload, { upsert: true });

    if (ttlSeconds) {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } else {
      await this.redis.set(key, JSON.stringify(value));
    }
  }

  async invalidate(tag: string) {
    const docs = await CacheModel.find({ tags: tag });
    await Promise.all(docs.map(doc => this.redis.del(doc.key)));
    await CacheModel.deleteMany({ tags: tag });
    logger.debug({ tag }, 'Cache invalidated');
  }

  async del(key: string): Promise<number> {
    return await this.redis.del(key);
  }

  async keys(pattern: string): Promise<string[]> {
    return await this.redis.keys(pattern);
  }

  private getTtlSeconds(doc: CacheDoc) {
    if (!doc.expiresAt) {
      return 60;
    }
    const ms = doc.expiresAt.getTime() - Date.now();
    return Math.max(Math.floor(ms / 1000), 1);
  }
}
