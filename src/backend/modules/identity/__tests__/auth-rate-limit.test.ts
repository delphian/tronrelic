/**
 * Tests for the sign-in rate limiting added after the 28–29 Sep 2026 probing:
 * the atomic Redis window counter, the Better Auth storage built on it, and
 * the per-email OTP throttle.
 *
 * Redis is replaced by a small fake that interprets the counter script's
 * effect (increment, set the expiry once, report the time left), so the tests
 * check the limits themselves rather than the Lua text.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ISystemLogService } from '@/types';
import type { IAuthRateLimitRedis } from '../services/IAuthRateLimitRedis.js';
import { consumeRedisWindow } from '../services/consumeRedisWindow.js';
import { createRedisRateLimitStorage } from '../services/createRedisRateLimitStorage.js';
import { EMAIL_OTP_THROTTLE, enforceEmailOtpLimit } from '../services/createEmailOtpThrottle.js';

/**
 * In-memory stand-in for the Redis commands the limiters use.
 *
 * `eval` ignores the script and applies what it does: increment the key,
 * start its window on the first increment, and return the count and the
 * seconds left. `fail` makes every command reject, to exercise the
 * fail-open path.
 */
class FakeRedis implements IAuthRateLimitRedis {
    readonly counts = new Map<string, number>();
    readonly ttls = new Map<string, number>();
    readonly values = new Map<string, string>();
    fail = false;

    /**
     * Apply the counter script's effect to one key.
     *
     * @param _script - Ignored; the fake models the script's behaviour.
     * @param _numKeys - Always 1 for the counter script.
     * @param args - The key, then the window length in seconds.
     * @returns `[count, secondsLeft]`, as the real script does.
     */
    async eval(_script: string, _numKeys: number, ...args: Array<string | number>): Promise<unknown> {
        if (this.fail) {
            throw new Error('redis down');
        }
        const [key, window] = [String(args[0]), Number(args[1])];
        const count = (this.counts.get(key) ?? 0) + 1;
        this.counts.set(key, count);
        if (!this.ttls.has(key)) {
            this.ttls.set(key, window);
        }
        return [count, this.ttls.get(key)];
    }

    /**
     * Read a stored record.
     *
     * @param key - Key to read.
     * @returns The stored string, or null when absent.
     */
    async get(key: string): Promise<string | null> {
        if (this.fail) {
            throw new Error('redis down');
        }
        return this.values.get(key) ?? null;
    }

    /**
     * Store a record and remember its expiry.
     *
     * @param key - Key to write.
     * @param value - Serialized record.
     * @param _mode - Always `EX`.
     * @param seconds - Expiry the caller asked for.
     * @returns `OK`, as ioredis does.
     */
    async set(key: string, value: string, _mode: 'EX', seconds: number): Promise<unknown> {
        if (this.fail) {
            throw new Error('redis down');
        }
        this.values.set(key, value);
        this.ttls.set(key, seconds);
        return 'OK';
    }
}

/**
 * Build a logger double whose methods are spies.
 *
 * @returns A logger the code under test can call freely.
 */
function buildLogger(): ISystemLogService {
    const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        child: () => logger
    } as unknown as ISystemLogService;
    return logger;
}

describe('consumeRedisWindow', () => {
    it('allows up to max requests, then refuses with the time left in the window', async () => {
        const redis = new FakeRedis();

        const results = [];
        for (let i = 0; i < 4; i++) {
            results.push(await consumeRedisWindow(redis, 'k', 60, 3));
        }

        expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
        expect(results[3].retryAfter).toBe(60);
        expect(results[0].retryAfter).toBeNull();
    });

    it('throws on a reply it cannot read, so callers can apply their own failure policy', async () => {
        const redis = new FakeRedis();
        redis.eval = async () => 'nonsense';

        await expect(consumeRedisWindow(redis, 'k', 60, 3)).rejects.toThrow(/Unexpected reply/);
    });
});

describe('createRedisRateLimitStorage', () => {
    it('namespaces keys and enforces the rule Better Auth passes in', async () => {
        const redis = new FakeRedis();
        const storage = createRedisRateLimitStorage(redis, 'tronrelic', buildLogger());

        const first = await storage.consume!('1.2.3.4/sign-in/email-otp', { window: 60, max: 1 });
        const second = await storage.consume!('1.2.3.4/sign-in/email-otp', { window: 60, max: 1 });

        expect(first.allowed).toBe(true);
        expect(second.allowed).toBe(false);
        expect([...redis.counts.keys()]).toEqual(['tronrelic:auth:ratelimit:1.2.3.4/sign-in/email-otp']);
    });

    it('allows the request and logs an error when Redis fails', async () => {
        const redis = new FakeRedis();
        redis.fail = true;
        const logger = buildLogger();
        const storage = createRedisRateLimitStorage(redis, 'tronrelic', logger);

        const result = await storage.consume!('k', { window: 60, max: 1 });

        expect(result).toEqual({ allowed: true, retryAfter: null });
        expect(logger.error).toHaveBeenCalled();
    });

    it('writes fallback records with an expiry so none live forever', async () => {
        const redis = new FakeRedis();
        const storage = createRedisRateLimitStorage(redis, 'tronrelic', buildLogger());

        await storage.set('k', { key: 'k', count: 1, lastRequest: 0 });

        expect(redis.ttls.get('tronrelic:auth:ratelimit:k')).toBeGreaterThan(0);
        expect(await storage.get('k')).toEqual({ key: 'k', count: 1, lastRequest: 0 });
    });
});

describe('enforceEmailOtpLimit', () => {
    let redis: FakeRedis;
    let logger: ISystemLogService;

    /**
     * Send one request through the throttle.
     *
     * @param path - Better Auth endpoint path.
     * @param email - Address in the body.
     * @returns Resolves when allowed; rejects with the 429 APIError when refused.
     */
    const hit = (path: string, email: unknown) => enforceEmailOtpLimit(redis, 'tronrelic', logger, path, { email });

    beforeEach(() => {
        redis = new FakeRedis();
        logger = buildLogger();
    });

    it('refuses sends to one address beyond the limit, whatever its capitalisation', async () => {
        for (let i = 0; i < EMAIL_OTP_THROTTLE.maxSends; i++) {
            await hit('/email-otp/send-verification-otp', i % 2 ? 'Victim@Example.com' : ' victim@example.com ');
        }

        await expect(hit('/email-otp/send-verification-otp', 'victim@example.com'))
            .rejects.toMatchObject({ statusCode: 429 });
        expect(logger.warn).toHaveBeenCalledWith(
            expect.objectContaining({ emailDomain: 'example.com', bucket: 'send' }),
            expect.any(String)
        );
    });

    it('counts every code-checking endpoint against one shared budget', async () => {
        const paths = ['/sign-in/email-otp', '/email-otp/check-verification-otp', '/email-otp/verify-email'];
        for (let i = 0; i < EMAIL_OTP_THROTTLE.maxChecks; i++) {
            await hit(paths[i % paths.length], 'victim@example.com');
        }

        await expect(hit('/sign-in/email-otp', 'victim@example.com')).rejects.toMatchObject({ statusCode: 429 });
    });

    it('keeps sends and checks in separate budgets, and addresses apart', async () => {
        for (let i = 0; i < EMAIL_OTP_THROTTLE.maxSends; i++) {
            await hit('/email-otp/send-verification-otp', 'victim@example.com');
        }

        await expect(hit('/sign-in/email-otp', 'victim@example.com')).resolves.toBeUndefined();
        await expect(hit('/email-otp/send-verification-otp', 'other@example.com')).resolves.toBeUndefined();
    });

    it('ignores other endpoints and bodies without a string email', async () => {
        await hit('/get-session', 'victim@example.com');
        await hit('/sign-in/email-otp', { $ne: '' });
        await enforceEmailOtpLimit(redis, 'tronrelic', logger, '/sign-in/email-otp', undefined);

        expect(redis.counts.size).toBe(0);
    });

    it('keys Redis by a fixed-size hash of the address, never the address itself', async () => {
        await hit('/email-otp/send-verification-otp', 'victim@example.com');

        const [key] = [...redis.counts.keys()];
        expect(key).not.toContain('victim');
        expect(key).toMatch(/^tronrelic:auth:otp-email:send:[0-9a-f]{64}$/);
    });

    it('does not count a value longer than any real email address', async () => {
        await hit('/sign-in/email-otp', `${'a'.repeat(300)}@example.com`);

        expect(redis.counts.size).toBe(0);
    });

    it('allows the request and logs an error when Redis fails', async () => {
        redis.fail = true;

        await expect(hit('/sign-in/email-otp', 'victim@example.com')).resolves.toBeUndefined();
        expect(logger.error).toHaveBeenCalled();
    });
});
