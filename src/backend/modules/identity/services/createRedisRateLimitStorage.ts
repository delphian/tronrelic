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

/** Most refused keys remembered for log de-duplication before the list is emptied. */
const MAX_TRACKED_REFUSALS = 1000;

/**
 * Build a Better Auth rate-limit storage whose counters live in Redis.
 *
 * Better Auth calls only `consume` on a custom storage. It counts through
 * {@link consumeRedisWindow}, so each check-and-increment is a single atomic
 * Redis step, and concurrent requests cannot all pass a stale read.
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
    const loggedUntil = new Map<string, number>();

    /**
     * Decide whether a refusal is worth a log entry. A caller who keeps
     * sending after being refused would otherwise write one persisted entry
     * per request, which lets anyone fill the log store from outside. One
     * entry per key per window says the same thing.
     *
     * @param key - Better Auth's counter key for the refused request.
     * @param windowSeconds - Length of the window the key is counted over.
     * @returns True the first time a key is refused in a window.
     */
    const shouldLogRefusal = (key: string, windowSeconds: number): boolean => {
        const now = Date.now();
        const isNew = (loggedUntil.get(key) ?? 0) <= now;
        if (isNew) {
            // Keys are caller-controlled, so the map is emptied when it grows
            // past a fixed size instead of being left to grow without limit.
            if (loggedUntil.size >= MAX_TRACKED_REFUSALS) {
                loggedUntil.clear();
            }
            loggedUntil.set(key, now + windowSeconds * 1000);
        }
        return isNew;
    };

    const storage: RateLimitStorage = {
        /**
         * Record one request and decide whether Better Auth lets it through.
         *
         * Better Auth calls this once per rate-limited request. The count is
         * kept under the deployment's namespace in Redis, so the limit holds
         * across restarts and across backend instances. A Redis failure
         * allows the request, for the reason given above.
         *
         * @param key - Better Auth's counter key (client IP and path), so each
         *   endpoint is counted separately for each address.
         * @param rule - Window length in seconds and the most requests allowed
         *   in it, as Better Auth configured for this path.
         * @returns Whether the request is allowed, and when it is not, the
         *   seconds until the window frees up, which Better Auth sends back
         *   to the client as `X-Retry-After`.
         */
        consume: async (key: string, rule: { window: number; max: number }) => {
            let result: { allowed: boolean; retryAfter: number | null } = { allowed: true, retryAfter: null };
            try {
                result = await consumeRedisWindow(redis, prefix + key, rule.window, rule.max);
            } catch (error) {
                logger.error({ error, key }, 'Auth rate-limit check failed; allowing the request');
            }
            if (!result.allowed && shouldLogRefusal(key, rule.window)) {
                // Better Auth answers the caller with 429 and logs nothing
                // itself, and a refused request never reaches the sign-in
                // audit hook. The key holds the caller's address and the path.
                logger.warn({ key, retryAfter: result.retryAfter }, 'Auth rate limit reached; request refused');
            }
            return result;
        }
    };
    return storage;
}
