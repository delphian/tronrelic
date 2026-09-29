/**
 * @fileoverview Redis-backed storage for Better Auth's built-in rate limiter.
 *
 * Better Auth keeps its per-IP counters in process memory by default. Those
 * counters reset on every backend restart, and a restart is exactly what an
 * attacker who can crash the backend gets for free: on 29 Sep 2026 production
 * restarted six times in one morning while an automated prober was guessing
 * at the email sign-in endpoints. Keeping the counters in Redis makes the
 * limit hold across restarts and across backend instances.
 *
 * Better Auth's `secondaryStorage` option would also move the counters to
 * Redis, but it moves sessions there too, which is a much larger change. The
 * `rateLimit.customStorage` hook changes only the counters.
 */

import type { BetterAuthOptions } from 'better-auth';
import type { ISystemLogService } from '@/types';
import type { IAuthRateLimitRedis } from './IAuthRateLimitRedis.js';
import { consumeRedisWindow } from './consumeRedisWindow.js';

/** The storage contract Better Auth accepts for `rateLimit.customStorage`. */
type RateLimitStorage = NonNullable<NonNullable<BetterAuthOptions['rateLimit']>['customStorage']>;

/** Record shape Better Auth reads and writes through `get` and `set`. */
type RateLimitRecord = NonNullable<Awaited<ReturnType<RateLimitStorage['get']>>>;

/**
 * Expiry applied to records written through Better Auth's non-atomic
 * `set` path. That path carries no window length, so the record needs an
 * upper bound of its own to stop it living forever. An hour is longer than
 * any window Better Auth or this module configures.
 */
const FALLBACK_RECORD_TTL_SECONDS = 3600;

/**
 * Build a Better Auth rate-limit storage whose counters live in Redis.
 *
 * `consume` is the path Better Auth uses whenever a storage provides it. It
 * counts through {@link consumeRedisWindow}, so each check-and-increment is a
 * single atomic Redis step. `get` and `set` exist only because the contract
 * requires them for storages without `consume`.
 *
 * When Redis cannot be reached, a request is allowed and the failure is
 * logged. Refusing instead would lock every visitor out of signing in for as
 * long as Redis is down, and Redis being down already stops block sync and
 * the job queues, so the outage is visible on `/system` either way.
 *
 * @param redis - Redis client holding the counters; the bootstrap client satisfies it.
 * @param namespace - Deployment Redis namespace (`REDIS_NAMESPACE`), so two
 *   deployments sharing a Redis never share counters.
 * @param logger - Logger for Redis failures, so a limiter that has stopped
 *   limiting is visible in the identity module's logs.
 * @returns Storage to pass as `rateLimit.customStorage`.
 */
export function createRedisRateLimitStorage(
    redis: IAuthRateLimitRedis,
    namespace: string,
    logger: ISystemLogService
): RateLimitStorage {
    const prefix = `${namespace}:auth:ratelimit:`;

    const storage: RateLimitStorage = {
        get: async (key: string): Promise<RateLimitRecord | null> => {
            let record: RateLimitRecord | null = null;
            try {
                const raw = await redis.get(prefix + key);
                record = raw ? (JSON.parse(raw) as RateLimitRecord) : null;
            } catch (error) {
                logger.error({ error, key }, 'Auth rate-limit read failed; treating as no prior requests');
            }
            return record;
        },
        set: async (key: string, value: RateLimitRecord): Promise<void> => {
            try {
                await redis.set(prefix + key, JSON.stringify(value), 'EX', FALLBACK_RECORD_TTL_SECONDS);
            } catch (error) {
                logger.error({ error, key }, 'Auth rate-limit write failed');
            }
        },
        consume: async (key: string, rule: { window: number; max: number }) => {
            let result: { allowed: boolean; retryAfter: number | null } = { allowed: true, retryAfter: null };
            try {
                result = await consumeRedisWindow(redis, prefix + key, rule.window, rule.max);
            } catch (error) {
                logger.error({ error, key }, 'Auth rate-limit check failed; allowing the request');
            }
            return result;
        }
    };
    return storage;
}
