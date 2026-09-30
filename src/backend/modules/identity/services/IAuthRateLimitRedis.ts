/**
 * @fileoverview The slice of a Redis client the auth rate limiters need.
 *
 * Declared structurally so the identity module depends on the one command it
 * uses rather than on the whole ioredis client, and so tests can hand in a
 * small fake. The ioredis client the bootstrap creates satisfies it as is.
 */

/**
 * Redis commands used by the Better Auth rate-limit storage and the per-email
 * sign-in throttle.
 */
export interface IAuthRateLimitRedis {
    /**
     * Run a Lua script atomically. The counters rely on this so that the
     * increment and the expiry are set in one step; two separate commands
     * could leave a key with no expiry if the process stopped between them,
     * and that caller would then be locked out for good.
     */
    eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
}
