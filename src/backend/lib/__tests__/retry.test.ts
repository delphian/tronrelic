/**
 * @fileoverview Unit tests for the shared retry helper.
 *
 * The helper decides how often every vendor client calls an external API after
 * a failure, so these tests lock the pacing rules: only errors a later attempt
 * can fix are retried, each wait is jittered and capped, a server's
 * `Retry-After` is honoured, a `Retry-After` longer than the caller will wait
 * ends the retries instead of stalling, and a caller can replace the wait and
 * learn each wait's length.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { retry, isRetryableError, retryAfterMs } from '../retry.js';

/**
 * Build an error shaped like the one axios throws for an HTTP response.
 *
 * @param status - The response status the fake server returned.
 * @param headers - Response headers, such as `retry-after`.
 * @returns An error carrying `response.status` and `response.headers`.
 */
function httpError(status: number, headers: Record<string, string> = {}): Error {
    return Object.assign(new Error(`HTTP ${status}`), { response: { status, headers } });
}

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('isRetryableError', () => {
    it('retries network failures, timeouts, rate limits, and server errors', () => {
        expect(isRetryableError(new Error('socket hang up'))).toBe(true);
        expect(isRetryableError(httpError(408))).toBe(true);
        expect(isRetryableError(httpError(429))).toBe(true);
        expect(isRetryableError(httpError(503))).toBe(true);
    });

    it('does not retry a final client error', () => {
        expect(isRetryableError(httpError(400))).toBe(false);
        expect(isRetryableError(httpError(401))).toBe(false);
        expect(isRetryableError(httpError(403))).toBe(false);
        expect(isRetryableError(httpError(404))).toBe(false);
    });
});

describe('retryAfterMs', () => {
    it('reads a number of seconds', () => {
        expect(retryAfterMs(httpError(429, { 'retry-after': '7' }))).toBe(7000);
    });

    it('reads an HTTP date', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        expect(retryAfterMs(httpError(503, { 'retry-after': 'Thu, 01 Jan 2026 00:00:30 GMT' }))).toBe(30_000);
    });

    it('returns undefined when the header is absent', () => {
        expect(retryAfterMs(httpError(429))).toBeUndefined();
        expect(retryAfterMs(new Error('network'))).toBeUndefined();
    });
});

describe('retry', () => {
    it('stops after one attempt on a non-retryable error', async () => {
        const fn = vi.fn().mockRejectedValue(httpError(401));
        await expect(retry(fn, { retries: 3, delayMs: 1 })).rejects.toThrow('HTTP 401');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries a retryable error up to the limit, then throws the last error', async () => {
        const fn = vi.fn().mockRejectedValue(httpError(503));
        await expect(retry(fn, { retries: 2, delayMs: 1 })).rejects.toThrow('HTTP 503');
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('returns the first success', async () => {
        const fn = vi.fn().mockRejectedValueOnce(httpError(500)).mockResolvedValue('ok');
        await expect(retry(fn, { retries: 2, delayMs: 1 })).resolves.toBe('ok');
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('jitters each wait between half and all of the capped backoff', async () => {
        vi.useFakeTimers();
        vi.spyOn(Math, 'random').mockReturnValue(0);
        const fn = vi.fn().mockRejectedValueOnce(httpError(500)).mockResolvedValue('ok');
        const pending = retry(fn, { retries: 1, delayMs: 60_000, maxDelayMs: 10_000 });
        // Capped to 10s, and a random draw of 0 gives the lower bound of half of that.
        await vi.advanceTimersByTimeAsync(4_999);
        expect(fn).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        await expect(pending).resolves.toBe('ok');
    });

    it('waits at least as long as Retry-After asks', async () => {
        vi.useFakeTimers();
        const fn = vi.fn().mockRejectedValueOnce(httpError(429, { 'retry-after': '20' })).mockResolvedValue('ok');
        const pending = retry(fn, { retries: 1, delayMs: 100 });
        await vi.advanceTimersByTimeAsync(19_999);
        expect(fn).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        await expect(pending).resolves.toBe('ok');
    });

    it('waits through an injected sleep and reports each wait to onRetry', async () => {
        // A caller testing every retry must not sit through real delays, and a
        // caller logging retries needs to say how long the next wait is.
        vi.spyOn(Math, 'random').mockReturnValue(0);
        const sleep = vi.fn(async (_ms: number) => {});
        const onRetry = vi.fn();
        const fn = vi.fn().mockRejectedValue(new Error('down'));

        await expect(retry(fn, { retries: 2, delayMs: 500, sleep, onRetry })).rejects.toThrow('down');

        expect(sleep.mock.calls.map(call => call[0])).toEqual([250, 500]);
        expect(onRetry.mock.calls.map(call => [call[0], call[2]])).toEqual([[1, 250], [2, 500]]);
    });

    it('gives up rather than wait out a Retry-After longer than the ceiling', async () => {
        const fn = vi.fn().mockRejectedValue(httpError(429, { 'retry-after': '3600' }));
        await expect(retry(fn, { retries: 3, delayMs: 1, maxRetryAfterMs: 60_000 })).rejects.toThrow('HTTP 429');
        expect(fn).toHaveBeenCalledTimes(1);
    });
});
