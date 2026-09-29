/**
 * @fileoverview Atomic fixed-window request counter stored in Redis.
 *
 * Shared by the Better Auth rate-limit storage (keyed by IP address and path)
 * and the per-email sign-in throttle (keyed by email address), so both count
 * requests the same way and survive a backend restart.
 */

import type { IAuthRateLimitRedis } from './IAuthRateLimitRedis.js';

/**
 * Lua script that counts one request and returns the new count and the
 * seconds left in the window.
 *
 * INCR and EXPIRE run in one atomic step so a key can never be left without
 * an expiry. The second EXPIRE repairs a key that somehow lost its TTL (for
 * example one written by an older version of this code), for the same reason.
 */
const CONSUME_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
    ttl = tonumber(ARGV[1])
end
return { count, ttl }
`;

/**
 * Outcome of counting one request against a window.
 */
export interface IRedisWindowResult {
    /** True when the request is within the limit and may proceed. */
    allowed: boolean;

    /** Seconds until the window frees up when refused; null when allowed. */
    retryAfter: number | null;
}

/**
 * Count one request against a fixed window and report whether it is allowed.
 *
 * The first request in a window starts it; every request, allowed or not,
 * increments the count, so a caller that keeps retrying while refused does
 * not earn extra attempts.
 *
 * @param redis - Redis client used to store the counter.
 * @param key - Fully namespaced Redis key for this caller and action.
 * @param windowSeconds - Length of the window; the key expires when it ends.
 * @param max - Requests allowed per window before refusing.
 * @returns Whether this request is allowed and, if not, when to retry.
 */
export async function consumeRedisWindow(
    redis: IAuthRateLimitRedis,
    key: string,
    windowSeconds: number,
    max: number
): Promise<IRedisWindowResult> {
    const reply = await redis.eval(CONSUME_SCRIPT, 1, key, windowSeconds);
    const [count, ttl] = Array.isArray(reply) ? reply.map(Number) : [Number.NaN, Number.NaN];
    if (!Number.isFinite(count)) {
        throw new Error(`Unexpected reply from rate-limit script for key ${key}`);
    }
    const allowed = count <= max;
    const result: IRedisWindowResult = {
        allowed,
        retryAfter: allowed ? null : Math.max(1, Number.isFinite(ttl) ? ttl : windowSeconds)
    };
    return result;
}
