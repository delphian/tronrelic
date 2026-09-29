/**
 * Tests for the public blockchain REST surface — BlockchainController and the
 * router that mounts it at /api/blockchain.
 *
 * Two things are pinned here because an attacker used both against
 * production. The router must not expose a sync trigger, since a manual sync
 * is an admin action and anonymous callers used the public copy to force
 * sync cycles. And `transactions/latest` must never hand the service a limit
 * outside 1–600, including for non-numeric input, where `Math.min(NaN, 600)`
 * used to slip past the ceiling.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response } from 'express';

const getLatestTransactions = vi.fn(async () => []);

vi.mock('../blockchain.service.js', () => ({
    BlockchainService: {
        getInstance: () => ({ getLatestTransactions })
    }
}));

const { BlockchainController } = await import('../blockchain.controller.js');
const { blockchainRouter } = await import('../../../api/routes/blockchain.router.js');

/**
 * Build the smallest response double the controller needs, so a test can
 * read back what was sent.
 *
 * @returns A response whose `json` is a spy.
 */
function buildRes(): Response {
    const res = { json: vi.fn(), status: vi.fn() } as unknown as Response;
    (res.status as unknown as ReturnType<typeof vi.fn>).mockReturnValue(res);
    return res;
}

/**
 * Wrap a query object as a request, since the handler reads nothing else.
 *
 * @param query - The query string values the caller supplied.
 * @returns A request carrying only that query.
 */
function buildReq(query: Record<string, unknown>): Request {
    return { query } as unknown as Request;
}

describe('BlockchainController.latestTransactions', () => {
    beforeEach(() => {
        getLatestTransactions.mockClear();
    });

    it.each([
        ['absent', undefined, 50],
        ['within range', '120', 120],
        ['above the ceiling', '1000000000', 600],
        ['non-numeric', 'abc', 50],
        ['zero', '0', 50],
        ['negative', '-5', 50],
        ['fractional', '12.9', 12],
        ['an array', ['10', '20'], 50]
    ])('passes a bounded limit when the value is %s', async (_label, limit, expected) => {
        const controller = new BlockchainController();

        await controller.latestTransactions(buildReq(limit === undefined ? {} : { limit }), buildRes());

        expect(getLatestTransactions).toHaveBeenCalledWith(expected);
    });
});

describe('blockchainRouter', () => {
    it('exposes no sync route', () => {
        const router = blockchainRouter();
        const paths = router.stack
            .filter((layer) => layer.route)
            .map((layer) => layer.route!.path);

        expect(paths).not.toContain('/sync');
    });
});
