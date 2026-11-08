/**
 * @fileoverview Tests for TronGridClient.getBlockByNumber.
 *
 * Why these exist: a TronGrid node asked for a block it has not served yet
 * replies with HTTP 200 and an empty body. That reply used to pass through as
 * a success, so sync failed the block on its missing timestamp without trying
 * again and parked it in a five-minute cooldown. These cases pin the fix: an
 * empty reply is retried on its own budget of three, a block that arrives
 * within that budget is returned, one that never arrives fails with
 * `BlockNotYetAvailableError`, and transport retries do not use up that
 * budget.
 *
 * The HTTP layer is mocked so each case states exactly what TronGrid replied.
 * The real retry helper runs, because the two retry budgets are what is under
 * test, but its waits are skipped so the cases do not sit through real
 * backoff delays.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IRetryOptions } from '../../../lib/retry.js';

vi.mock('../../../lib/http-client.js', () => ({
    httpClient: { post: vi.fn(), get: vi.fn() }
}));

vi.mock('../../../lib/retry.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../lib/retry.js')>();
    return {
        ...actual,
        /**
         * Run the real retry helper with its waits removed, so every retry
         * path is exercised without real backoff delays.
         *
         * @param operation - The call being retried, passed through unchanged.
         * @param options - The caller's retry options, kept as they are except
         *                  for the wait.
         * @returns Whatever the real helper returns.
         */
        retry: <T>(operation: () => Promise<T>, options: IRetryOptions = {}): Promise<T> =>
            actual.retry(operation, { ...options, sleep: async () => undefined })
    };
});

import { httpClient } from '../../../lib/http-client.js';
import { TronGridClient } from '../tron-grid.client.js';
import { BlockNotYetAvailableError } from '../BlockNotYetAvailableError.js';

/** Block height used throughout; no case depends on its particular value. */
const BLOCK_NUMBER = 87_797_072;

/** A minimal served block: the header timestamp is the field the check reads. */
const SERVED_BLOCK = {
    blockID: '00000000053bad50d3cf5c1b20da7241b12ca3762a74ea806059e6dbee757499',
    block_header: {
        raw_data: {
            number: BLOCK_NUMBER,
            timestamp: 1_794_064_929_000,
            parentHash: '00000000053bad4fdcfa0bd554b9a7831fafc0ba3cf5c8b491a099fde0cca865',
            witness_address: '41aa'
        }
    },
    transactions: []
};

/**
 * Build the error `post()` throws for a refused connection, why: a transport
 * failure carries no HTTP status, which is what makes the inner retry treat it
 * as retryable.
 *
 * @returns An error shaped like the client's own connection-refused error.
 */
function connectionRefused(): Error {
    return Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
}

describe('TronGridClient.getBlockByNumber', () => {
    const post = httpClient.post as unknown as ReturnType<typeof vi.fn>;
    let client: TronGridClient;

    beforeEach(() => {
        post.mockReset();
        client = TronGridClient.getInstance();
    });

    it('returns a served block from the first reply', async () => {
        post.mockResolvedValue({ data: SERVED_BLOCK });

        const block = await client.getBlockByNumber(BLOCK_NUMBER);

        expect(post).toHaveBeenCalledTimes(1);
        expect(block.block_header.raw_data.timestamp).toBe(SERVED_BLOCK.block_header.raw_data.timestamp);
    });

    it('retries an empty reply and returns the block once TronGrid serves it', async () => {
        post.mockResolvedValueOnce({ data: {} }).mockResolvedValueOnce({ data: SERVED_BLOCK });

        const block = await client.getBlockByNumber(BLOCK_NUMBER);

        expect(post).toHaveBeenCalledTimes(2);
        expect(block.blockID).toBe(SERVED_BLOCK.blockID);
    });

    it('fails with BlockNotYetAvailableError after three retries of an empty reply', async () => {
        post.mockResolvedValue({ data: {} });

        const failure = await client.getBlockByNumber(BLOCK_NUMBER).catch((error: unknown) => error);

        // The first attempt plus three retries. A larger count would mean the
        // budget had grown, and every extra retry stalls the single fetch worker.
        expect(post).toHaveBeenCalledTimes(4);
        expect(failure).toBeInstanceOf(BlockNotYetAvailableError);
        expect((failure as BlockNotYetAvailableError).blockNumber).toBe(BLOCK_NUMBER);
    });

    it('does not count a transport retry against the not-yet-served budget', async () => {
        // A refused connection is retried by the inner transport loop. If it
        // also used up one of the three not-yet-served retries, the block would
        // fail before the fifth reply that finally carries it.
        post
            .mockRejectedValueOnce(connectionRefused())
            .mockResolvedValueOnce({ data: {} })
            .mockResolvedValueOnce({ data: {} })
            .mockResolvedValueOnce({ data: {} })
            .mockResolvedValueOnce({ data: SERVED_BLOCK });

        const block = await client.getBlockByNumber(BLOCK_NUMBER);

        expect(post).toHaveBeenCalledTimes(5);
        expect(block.blockID).toBe(SERVED_BLOCK.blockID);
    });
});
