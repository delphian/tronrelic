/**
 * Tests for the core transaction-detail AI tool. Covers the behaviors the tool
 * still owns now that governance is core: malformed ids are rejected before any
 * lookup, resolved and not-found outcomes return the right shape, and the tool
 * declares its read/internal capability so the governor classifies it. Rate
 * limiting and audit are the governor's concern and are tested with the AI
 * tools module, not here.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ITransactionDetailService, IBlockTransaction } from '@/types';
import { buildTransactionTool } from '../transaction-ai-tools.js';

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
    let handler: (input: Record<string, unknown>) => Promise<unknown>;

    beforeEach(() => {
        detailService = { getTransactionById: vi.fn() };
        const tool = buildTransactionTool(detailService as unknown as ITransactionDetailService);
        handler = tool.handler;
    });

    it('declares a read/internal capability', () => {
        const tool = buildTransactionTool(detailService as unknown as ITransactionDetailService);

        expect(tool.capability).toEqual({ sideEffect: 'read', reversible: true, sensitivity: 'internal' });
    });

    it('rejects a malformed txId before any lookup', async () => {
        const result = await handler({ txId: 'not-a-hash' });

        expect(result).toMatchObject({ success: false });
        expect(detailService.getTransactionById).not.toHaveBeenCalled();
    });

    it('resolves a valid transaction', async () => {
        detailService.getTransactionById.mockResolvedValue(sampleTx(VALID_TXID));

        const result = await handler({ txId: VALID_TXID });

        expect(result).toMatchObject({ success: true, transaction: { txId: VALID_TXID } });
        expect(detailService.getTransactionById).toHaveBeenCalledWith(VALID_TXID);
    });

    it('returns a null transaction when the lookup finds nothing', async () => {
        detailService.getTransactionById.mockResolvedValue(null);

        const result = await handler({ txId: VALID_TXID });

        expect(result).toMatchObject({ success: true, transaction: null });
    });

    it('returns a sanitized error when the lookup throws', async () => {
        detailService.getTransactionById.mockRejectedValue(new Error('boom'));

        const result = await handler({ txId: VALID_TXID });

        expect(result).toMatchObject({ success: false });
        expect((result as { error: string }).error).not.toContain('boom');
    });
});
