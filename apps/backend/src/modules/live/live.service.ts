import type { Redis as RedisClient } from 'ioredis';
import type { IDatabaseService } from '@tronrelic/types';
import { CacheService } from '../../services/cache.service.js';

const CACHE_KEYS = ['live:accounts:searches', 'telemetry:account-searches', 'api/account'];

export class LiveService {
  private readonly cache: CacheService;

  constructor(redis: RedisClient, database: IDatabaseService) {
    this.cache = new CacheService(redis, database);
  }

  async getAccountSearches(): Promise<Record<string, unknown>> {
    for (const key of CACHE_KEYS) {
      const value = await this.cache.get<Record<string, unknown>>(key);
      if (value) {
        return value;
      }
    }
    return {};
  }
}
