/**
 * Tests for the core transaction-detail AI tool and its safeguard. Covers the
 * behaviors that protect the system: malformed ids are rejected before any
 * lookup, the global rate limiter caps invocations and rejects past the cap,
 * resolved/not-found outcomes are recorded, and the stats snapshot reflects
 * all of it for the admin endpoint.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ITransactionDetailService, IBlockTransaction } from '@/types';
import { buildTransactionTool } from '../transaction-ai-tools.js';
import { TransactionToolGuard } from '../transaction-tool-guard.js';

const VALID_TXID = 'a'.repeat(64);

/** A minimal resolved transaction for the detail-service mock. */
function sampleTx(txId: string): IBlockTransaction {
    return {
        txId,
        blockNumber: 100,
        timestamp: new Date(),
        type: 'TransferContract',
        status: 'SUCCESS',
        from: { address: 'Tfrom' },
        to: { address: 'Tto' },
        feeSun: 0,
        memo: null
    };
}

describe('transaction AI tool', () => {
    let detailService: { getTransactionById: ReturnType<typeof vi.fn> };
    let guard: TransactionToolGuard;
    let handler: (input: Record<string, unknown>) => Promise<unknown>;

    beforeEach(() => {
        TransactionToolGuard.resetForTests();
        guard = TransactionToolGuard.getInstance();
        detailService = { getTransactionById: vi.fn() };
        const tool = buildTransactionTool(detailService as unknown as ITransactionDetailService, guard);
        handler = tool.handler;
    });

    it('rejects a malformed txId before any lookup and counts it', async () => {
        const result = await handler({ txId: 'not-a-hash' });

        expect(result).toMatchObject({ success: false });
        expect(detailService.getTransactionById).not.toHaveBeenCalled();
        expect(guard.snapshot()).toMatchObject({ invocations: 1, invalidInput: 1, allowed: 0 });
    });

    it('resolves a valid transaction and records the outcome', async () => {
        detailService.getTransactionById.mockResolvedValue(sampleTx(VALID_TXID));

        const result = await handler({ txId: VALID_TXID });

        expect(result).toMatchObject({ success: true, transaction: { txId: VALID_TXID } });
        expect(detailService.getTransactionById).toHaveBeenCalledWith(VALID_TXID);
        expect(guard.snapshot()).toMatchObject({ allowed: 1, resolved: 1, notFound: 0 });
    });

    it('records a not-found outcome when the lookup returns null', async () => {
        detailService.getTransactionById.mockResolvedValue(null);

        const result = await handler({ txId: VALID_TXID });

        expect(result).toMatchObject({ success: true, transaction: null });
        expect(guard.snapshot()).toMatchObject({ resolved: 0, notFound: 1 });
    });

    it('rate-limits once the window budget is exhausted', async () => {
        detailService.getTransactionById.mockResolvedValue(sampleTx(VALID_TXID));

        // Drain the window: the limit is read from the snapshot so the test
        // stays correct if the cap changes.
        const limit = guard.snapshot().window.limit;
        for (let i = 0; i < limit; i++) {
            await handler({ txId: VALID_TXID });
        }

        const rejected = await handler({ txId: VALID_TXID });

        expect(rejected).toMatchObject({ success: false });
        const stats = guard.snapshot();
        expect(stats.allowed).toBe(limit);
        expect(stats.rateLimited).toBe(1);
        expect(stats.window.remaining).toBe(0);
        expect(stats.lastRateLimitedAt).not.toBeNull();
    });
});
