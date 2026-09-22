/**
 * @fileoverview Unit tests for the TRX price service block sync reads.
 *
 * Sync asks for the price on every block, so the service decides how often
 * CoinGecko is called. When it cached only successes, a rate-limit response
 * became one request per block. These tests lock the request budget: concurrent
 * callers share one request, a failure backs off instead of being retried by
 * the next block, the backoff respects `Retry-After`, and a recent last-known
 * price is served while the vendor is failing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../lib/logger.js', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() }
}));
vi.mock('../../loaders/redis.js', () => ({
    getRedisClient: vi.fn()
}));

import { PriceService } from '../price.service.js';
import { ProviderDisabledError } from '../../modules/providers/capabilities/ProviderDisabledError.js';

/**
 * Build an in-memory stand-in for the Redis calls the service makes.
 *
 * @returns A fake with `get` and `setex` that always miss and record writes.
 */
function fakeRedis() {
    return { get: vi.fn().mockResolvedValue(null), setex: vi.fn().mockResolvedValue('OK') };
}

/**
 * Build an error shaped like an axios rate-limit response.
 *
 * @param headers - Response headers, such as `retry-after`.
 * @returns An error carrying `response.status` 429.
 */
function rateLimited(headers: Record<string, string> = {}): Error {
    return Object.assign(new Error('HTTP 429'), { response: { status: 429, headers } });
}

describe('PriceService', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('shares one request between concurrent callers and caches the answer', async () => {
        const fetchSpotPrice = vi.fn().mockResolvedValue(0.25);
        const service = new PriceService({ redis: fakeRedis() as never, fetchSpotPrice });
        const prices = await Promise.all([service.getTrxPriceUsd(), service.getTrxPriceUsd(), service.getTrxPriceUsd()]);
        expect(prices).toEqual([0.25, 0.25, 0.25]);
        await service.getTrxPriceUsd();
        expect(fetchSpotPrice).toHaveBeenCalledTimes(1);
    });

    it('backs off after a failure instead of retrying on the next block', async () => {
        const fetchSpotPrice = vi.fn().mockRejectedValue(rateLimited());
        const service = new PriceService({ redis: fakeRedis() as never, fetchSpotPrice });
        expect(await service.getTrxPriceUsd()).toBeNull();
        vi.advanceTimersByTime(29_000);
        expect(await service.getTrxPriceUsd()).toBeNull();
        expect(fetchSpotPrice).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(1_000);
        await service.getTrxPriceUsd();
        expect(fetchSpotPrice).toHaveBeenCalledTimes(2);
    });

    it('waits out a Retry-After longer than its own backoff', async () => {
        const fetchSpotPrice = vi.fn().mockRejectedValue(rateLimited({ 'retry-after': '120' }));
        const service = new PriceService({ redis: fakeRedis() as never, fetchSpotPrice });
        await service.getTrxPriceUsd();
        vi.advanceTimersByTime(119_000);
        await service.getTrxPriceUsd();
        expect(fetchSpotPrice).toHaveBeenCalledTimes(1);
    });

    it('re-checks a disabled vendor every 30 seconds instead of growing the backoff', async () => {
        const fetchSpotPrice = vi.fn().mockRejectedValue(new ProviderDisabledError('coingecko'));
        const service = new PriceService({ redis: fakeRedis() as never, fetchSpotPrice });
        for (let attempt = 1; attempt <= 4; attempt += 1) {
            await service.getTrxPriceUsd();
            vi.advanceTimersByTime(30_000);
        }
        // Four checks 30s apart; a growing backoff would have allowed only three in that time.
        expect(fetchSpotPrice).toHaveBeenCalledTimes(4);
    });

    it('serves the last-known price while failing, until it is too old', async () => {
        const fetchSpotPrice = vi.fn().mockResolvedValueOnce(0.3).mockRejectedValue(rateLimited());
        const service = new PriceService({ redis: fakeRedis() as never, fetchSpotPrice });
        expect(await service.getTrxPriceUsd()).toBe(0.3);
        vi.advanceTimersByTime(61_000);
        expect(await service.getTrxPriceUsd()).toBe(0.3);
        vi.advanceTimersByTime(15 * 60_000);
        expect(await service.getTrxPriceUsd()).toBeNull();
    });
});
