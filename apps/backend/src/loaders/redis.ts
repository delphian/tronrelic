import Redis from 'ioredis';
import type { Redis as RedisClient } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

let client: RedisClient | null = null;
type RedisCtor = typeof import('ioredis')['default'];

export function createRedisClient(): RedisClient {
  const RedisConstructor = Redis as unknown as RedisCtor;
  const instance = new RedisConstructor(env.REDIS_URL, {
    keyPrefix: `${env.REDIS_NAMESPACE}:`,
    lazyConnect: true,
    maxRetriesPerRequest: 3
  });

  instance.on('connect', () => logger.info('Redis connected'));
  instance.on('error', (error: Error) => logger.error({ error }, 'Redis error'));

  client = instance;
  return instance;
}

export function getRedisClient(): RedisClient {
  if (!client) {
    throw new Error('Redis client not initialized');
  }
  return client;
}

export async function disconnectRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}
