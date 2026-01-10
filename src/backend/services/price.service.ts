import type { Redis as RedisClient } from 'ioredis';
import { httpClient } from '../lib/http-client.js';
import { getRedisClient } from '../loaders/redis.js';
import { logger } from '../lib/logger.js';

interface PriceCacheEntry {
  value: number;
  fetchedAt: number;
}

const CACHE_KEY = 'prices:trx:usd';
const CACHE_TTL_SECONDS = 60;

export class PriceService {
  private static instance: PriceService | null = null;

  private readonly redis: RedisClient;
  private inMemory: PriceCacheEntry | null = null;

  private constructor() {
    this.redis = getRedisClient();
  }

  static getInstance() {
    if (!PriceService.instance) {
      PriceService.instance = new PriceService();
    }
    return PriceService.instance;
  }

  async getTrxPriceUsd(): Promise<number | null> {
    const now = Date.now();

    if (this.inMemory && now - this.inMemory.fetchedAt < CACHE_TTL_SECONDS * 1000) {
      return this.inMemory.value;
    }

    try {
      const cached = await this.redis.get(CACHE_KEY);
      if (cached) {
        const parsed = Number(cached);
        if (Number.isFinite(parsed)) {
          this.inMemory = { value: parsed, fetchedAt: now };
          return parsed;
        }
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to read price from redis');
    }

    const price = await this.fetchFromApi();
    if (price !== null) {
      this.inMemory = { value: price, fetchedAt: now };
      try {
        await this.redis.setex(CACHE_KEY, CACHE_TTL_SECONDS, price.toString());
      } catch (error) {
        logger.warn({ error }, 'Failed to persist TRX price to redis');
      }
    }

    return price;
  }

  private async fetchFromApi(): Promise<number | null> {
    try {
      const response = await httpClient.get<{ tron: { usd: number } }>(
        'https://api.coingecko.com/api/v3/simple/price',
        {
          params: {
            ids: 'tron',
            vs_currencies: 'usd'
          },
          timeout: 5000
        }
      );

      const value = response.data?.tron?.usd;
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }

      logger.warn({ data: response.data }, 'Unexpected response when fetching TRX price');
    } catch (error) {
      logger.error({ error }, 'Failed to fetch TRX price from API');
    }

    return null;
  }
}