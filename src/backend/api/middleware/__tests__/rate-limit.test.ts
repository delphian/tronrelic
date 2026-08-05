/**
 * @fileoverview Tests for the grouped admin rate limiter.
 *
 * These cover the two properties the /system/system 429 fix depends on: a
 * request is charged to the bucket its path selects, and it is charged exactly
 * once. The second property is the subtle one — an earlier shape that chained
 * path-scoped `router.use('/group', limiter)` calls alongside a catch-all would
 * have spent a slot from both the group bucket and the shared bucket per
 * request, leaving the shared bucket exhausting and the 429s unfixed.
 *
 * Redis is mocked at the loader boundary because the limiter resolves its
 * client per request; asserting on `incr` keys is what reveals which bucket a
 * request actually landed in.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const incr = vi.fn();
const expire = vi.fn();

vi.mock('../../../loaders/redis.js', () => ({
    getRedisClient: () => ({ incr, expire })
}));

const { createGroupedAdminRateLimiter } = await import('../rate-limit.js');

/**
 * Build a minimal Express request carrying only what the limiter reads.
 *
 * @param path - Router-relative path, as Express exposes it inside a mounted router.
 * @returns A request stub with the path and a fixed IP so bucket keys are stable.
 */
function requestFor(path: string): Request {
    return { path, ip: '10.0.0.1' } as Request;
}

/**
 * Build a response stub that records a 429 without touching a real socket.
 *
 * @returns The stub plus the status code it captured, if any.
 */
function responseStub(): { res: Response; statusCode: () => number | undefined } {
    let captured: number | undefined;
    const res = {
        status(code: number) {
            captured = code;
            return this;
        },
        json() {
            return this;
        }
    } as unknown as Response;
    return { res, statusCode: () => captured };
}

describe('createGroupedAdminRateLimiter', () => {
    beforeEach(() => {
        incr.mockReset();
        expire.mockReset();
        incr.mockResolvedValue(1);
        expire.mockResolvedValue(1);
    });

    const groups = {
        blockchain: 'system-blockchain',
        health: 'system-health',
        websockets: 'system-websockets'
    };

    it.each([
        ['/blockchain/status', 'ratelimit:system-blockchain:10.0.0.1'],
        ['/blockchain/observers', 'ratelimit:system-blockchain:10.0.0.1'],
        ['/health/redis', 'ratelimit:system-health:10.0.0.1'],
        ['/websockets/aggregate', 'ratelimit:system-websockets:10.0.0.1']
    ])('charges %s to its group bucket', async (path, expectedKey) => {
        const next = vi.fn();
        const limiter = createGroupedAdminRateLimiter(groups, 'system-monitor');

        await limiter(requestFor(path), responseStub().res, next as unknown as NextFunction);

        expect(incr).toHaveBeenCalledWith(expectedKey);
        expect(next).toHaveBeenCalledOnce();
    });

    it('falls back to the default bucket for an unregistered group', async () => {
        const next = vi.fn();
        const limiter = createGroupedAdminRateLimiter(groups, 'system-monitor');

        await limiter(requestFor('/config/system'), responseStub().res, next as unknown as NextFunction);

        expect(incr).toHaveBeenCalledWith('ratelimit:system-monitor:10.0.0.1');
        expect(next).toHaveBeenCalledOnce();
    });

    it('consumes exactly one slot per request', async () => {
        const next = vi.fn();
        const limiter = createGroupedAdminRateLimiter(groups, 'system-monitor');

        await limiter(requestFor('/blockchain/status'), responseStub().res, next as unknown as NextFunction);

        expect(incr).toHaveBeenCalledOnce();
    });

    it('keeps group buckets independent so one busy group cannot starve another', async () => {
        const limiter = createGroupedAdminRateLimiter(groups, 'system-monitor');

        // Exhausting blockchain must not affect health: the buckets are keyed apart,
        // which is the entire reason the dashboard's polling no longer collides.
        incr.mockResolvedValue(61);
        const blocked = responseStub();
        await limiter(requestFor('/blockchain/status'), blocked.res, vi.fn() as unknown as NextFunction);
        expect(blocked.statusCode()).toBe(429);

        incr.mockResolvedValue(1);
        const allowed = responseStub();
        const next = vi.fn();
        await limiter(requestFor('/health/redis'), allowed.res, next as unknown as NextFunction);

        expect(allowed.statusCode()).toBeUndefined();
        expect(next).toHaveBeenCalledOnce();
        expect(incr).toHaveBeenLastCalledWith('ratelimit:system-health:10.0.0.1');
    });

    it('answers 429 without calling next when a bucket is exhausted', async () => {
        const limiter = createGroupedAdminRateLimiter(groups, 'system-monitor');
        const next = vi.fn();
        const { res, statusCode } = responseStub();

        incr.mockResolvedValue(61);
        await limiter(requestFor('/blockchain/metrics'), res, next as unknown as NextFunction);

        expect(statusCode()).toBe(429);
        expect(next).not.toHaveBeenCalled();
    });
});
