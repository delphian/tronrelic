import type { Redis as RedisClient } from 'ioredis';
import type { ICacheService, IDatabaseService } from '@tronrelic/types';
import { CacheModel, type CacheDoc, type CacheFields } from '../database/models/cache-model.js';
import { logger } from '../lib/logger.js';

/**
 * CacheService
 *
 * Provides Redis-backed caching with MongoDB fallback for durability.
 * Supports time-to-live expiration and tag-based invalidation for
 * efficient cache management across related entries.
 *
 * Why this service exists:
 * Caching reduces database load and API latency by storing frequently
 * accessed data in Redis. MongoDB backing provides durability across
 * Redis restarts and enables tag-based bulk invalidation.
 *
 * Database access pattern:
 * Uses IDatabaseService for all MongoDB operations, enabling testability
 * through mock implementations. The CacheModel is registered for Mongoose
 * schema validation on writes.
 */
export class CacheService implements ICacheService {
  private readonly COLLECTION_NAME = 'caches';

  /**
   * Create a cache service instance.
   *
   * @param redis - Redis client for fast key-value access
   * @param database - Database service for MongoDB persistence
   */
  constructor(
    private readonly redis: RedisClient,
    private readonly database: IDatabaseService
  ) {
    // Register Mongoose model for schema validation and defaults
    this.database.registerModel(this.COLLECTION_NAME, CacheModel);
  }

  /**
   * Retrieve a cached value by key.
   *
   * Checks Redis first for fast access, falls back to MongoDB if not found,
   * and repopulates Redis from MongoDB hit.
   *
   * @param key - Cache key to retrieve
   * @returns Parsed value if found and not expired, null otherwise
   */
  async get<T>(key: string): Promise<T | null> {
    const cached = await this.redis.get(key);
    if (cached) {
      return JSON.parse(cached) as T;
    }

    const doc = await this.database.findOne<CacheDoc>(this.COLLECTION_NAME, { key });
    if (!doc) {
      return null;
    }

    if (doc.expiresAt && doc.expiresAt < new Date()) {
      return null;
    }

    await this.redis.set(key, JSON.stringify(doc.value), 'EX', this.getTtlSeconds(doc));
    return doc.value as T;
  }

  /**
   * Store a value in cache with optional TTL and tags.
   *
   * Writes to both Redis (fast access) and MongoDB (durability).
   *
   * @param key - Cache key to store under
   * @param value - Value to cache (must be JSON-serializable)
   * @param ttlSeconds - Optional time-to-live in seconds
   * @param tags - Optional tags for group invalidation
   */
  async set<T>(key: string, value: T, ttlSeconds?: number, tags?: string[]) {
    const payload: Partial<CacheFields<T>> = {
      value,
      tags,
      expiresAt: ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000) : undefined
    };

    // Use registered model for upsert with schema validation
    const model = this.database.getModel<CacheDoc>(this.COLLECTION_NAME);
    await model.updateOne({ key }, payload, { upsert: true });

    if (ttlSeconds) {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } else {
      await this.redis.set(key, JSON.stringify(value));
    }
  }

  /**
   * Invalidate all cache entries with a specific tag.
   *
   * Removes matching entries from both Redis and MongoDB.
   *
   * @param tag - Tag to match for invalidation
   */
  async invalidate(tag: string) {
    const docs = await this.database.find<CacheDoc>(this.COLLECTION_NAME, { tags: tag });
    await Promise.all(docs.map(doc => this.redis.del(doc.key)));
    await this.database.deleteMany(this.COLLECTION_NAME, { tags: tag });
    logger.debug({ tag }, 'Cache invalidated');
  }

  /**
   * Delete a specific cache entry by key.
   *
   * @param key - Cache key to delete
   * @returns Number of keys removed (0 or 1)
   */
  async del(key: string): Promise<number> {
    return await this.redis.del(key);
  }

  /**
   * Find all cache keys matching a pattern.
   *
   * @param pattern - Redis key pattern with wildcards
   * @returns Array of matching cache keys
   */
  async keys(pattern: string): Promise<string[]> {
    return await this.redis.keys(pattern);
  }

  /**
   * Calculate TTL seconds from document expiration date.
   *
   * @param doc - Cache document with optional expiresAt field
   * @returns TTL in seconds, minimum 1 second
   */
  private getTtlSeconds(doc: CacheFields) {
    if (!doc.expiresAt) {
      return 60;
    }
    const ms = doc.expiresAt.getTime() - Date.now();
    return Math.max(Math.floor(ms / 1000), 1);
  }
}
