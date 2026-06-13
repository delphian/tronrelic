/**
 * Tests for TransactionDetailService — the read-through, permanently-cached
 * transaction lookup. Covers the orchestration that matters: cache hits avoid
 * the provider, misses fetch-assemble-persist, repeat lookups serve from cache,
 * batches fill only their misses, ids are de-duplicated, and an unresolvable
 * transaction returns null.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IDatabaseService } from '@/types';
import { TransactionDetailService } from '../transaction-detail.service.js';
import type { TronGridClient, TronGridTransaction, TronGridTransactionInfo } from '../tron-grid.client.js';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';

const COLLECTION = 'core_transaction_details';
const HEX_ADDRESS = '41a614f803b6fd780986a42c78ec9c7f77e6ded13c';

// Real TRON transaction ids are 64-char hex; the service validates this shape
// and drops anything else, so test fixtures must use well-formed ids.
const TX_CACHED = 'a'.repeat(64);
const TX_MISS = 'b'.repeat(64);
const TX_PERSIST = 'c'.repeat(64);
const TX_BATCH_HIT = 'd'.repeat(64);
const TX_BATCH_MISS = 'e'.repeat(64);
const TX_DUP = 'f'.repeat(64);
const TX_GONE = '0'.repeat(64);

/** Build a minimal raw transaction (TransferContract) for the given id. */
function rawTransfer(txId: string): TronGridTransaction {
    return {
        txID: txId,
        raw_data: {
            contract: [{
                type: 'TransferContract',
                parameter: { value: { owner_address: HEX_ADDRESS, to_address: HEX_ADDRESS, amount: 1_000_000 } }
            }]
        },
        ret: [{ contractRet: 'SUCCESS', fee: 0 }]
    } as unknown as TronGridTransaction;
}

/** Build the matching receipt for the given id. */
function infoFor(txId: string): TronGridTransactionInfo {
    return {
        id: txId,
        fee: 1100,
        blockNumber: 555,
        blockTimeStamp: 1_700_000_000_000,
        receipt: { energy_usage_total: 0, energy_fee: 0, net_usage: 268, net_fee: 1100, result: 'SUCCESS' }
    } as TronGridTransactionInfo;
}

interface MockProvider {
    getTransactionById: ReturnType<typeof vi.fn>;
    getTransactionInfo: ReturnType<typeof vi.fn>;
}

describe('TransactionDetailService', () => {
    let database: IDatabaseService;
    let provider: MockProvider;
    let service: TransactionDetailService;

    beforeEach(() => {
        // Reset the singleton so each test wires fresh mocks.
        (TransactionDetailService as unknown as { instance: TransactionDetailService | null }).instance = null;
        database = createMockDatabaseService();
        provider = {
            getTransactionById: vi.fn(),
            getTransactionInfo: vi.fn()
        };
        TransactionDetailService.setDependencies(database, provider as unknown as TronGridClient);
        service = TransactionDetailService.getInstance();
    });

    it('serves a cache hit without calling the provider', async () => {
        await database.insertOne(COLLECTION, {
            txId: TX_CACHED,
            blockNumber: 999,
            timestamp: new Date(),
            type: 'TransferContract',
            status: 'SUCCESS',
            from: { address: 'Tfrom' },
            to: { address: 'Tto' },
            feeSun: 0,
            memo: null
        });

        const tx = await service.getTransactionById(TX_CACHED);

        expect(tx?.blockNumber).toBe(999);
        expect(provider.getTransactionById).not.toHaveBeenCalled();
        expect(provider.getTransactionInfo).not.toHaveBeenCalled();
    });

    it('fills a miss from the provider and maps chain fields', async () => {
        provider.getTransactionById.mockResolvedValue(rawTransfer(TX_MISS));
        provider.getTransactionInfo.mockResolvedValue(infoFor(TX_MISS));

        const tx = await service.getTransactionById(TX_MISS);

        expect(tx).toMatchObject({
            txId: TX_MISS,
            blockNumber: 555,
            type: 'TransferContract',
            status: 'SUCCESS',
            amountSun: 1_000_000,
            feeSun: 1100,
            bandwidth: { consumed: 268, feeSun: 1100 }
        });
        // energy was neither consumed nor charged → omitted entirely.
        expect(tx?.energy).toBeUndefined();
        // No native contract call → no contract detail on a plain transfer.
        expect(tx?.contract).toBeUndefined();
        expect(tx?.memo).toBeNull();
    });

    it('persists a miss so the next lookup is a cache hit', async () => {
        provider.getTransactionById.mockResolvedValue(rawTransfer(TX_PERSIST));
        provider.getTransactionInfo.mockResolvedValue(infoFor(TX_PERSIST));

        await service.getTransactionById(TX_PERSIST);
        await service.getTransactionById(TX_PERSIST);

        expect(provider.getTransactionById).toHaveBeenCalledTimes(1);
        expect(provider.getTransactionInfo).toHaveBeenCalledTimes(1);
    });

    it('fills only the misses in a batch', async () => {
        await database.insertOne(COLLECTION, {
            txId: TX_BATCH_HIT, blockNumber: 1, timestamp: new Date(), type: 'TransferContract',
            status: 'SUCCESS', from: { address: 'a' }, to: { address: 'b' }, feeSun: 0, memo: null
        });
        provider.getTransactionById.mockResolvedValue(rawTransfer(TX_BATCH_MISS));
        provider.getTransactionInfo.mockResolvedValue(infoFor(TX_BATCH_MISS));

        const txs = await service.getTransactionsByIds([TX_BATCH_HIT, TX_BATCH_MISS]);

        expect(txs.map(t => t.txId).sort()).toEqual([TX_BATCH_HIT, TX_BATCH_MISS].sort());
        expect(provider.getTransactionById).toHaveBeenCalledTimes(1);
        expect(provider.getTransactionById).toHaveBeenCalledWith(TX_BATCH_MISS);
    });

    it('de-duplicates repeated ids into a single provider fetch', async () => {
        provider.getTransactionById.mockResolvedValue(rawTransfer(TX_DUP));
        provider.getTransactionInfo.mockResolvedValue(infoFor(TX_DUP));

        const txs = await service.getTransactionsByIds([TX_DUP, TX_DUP, TX_DUP]);

        expect(txs).toHaveLength(1);
        expect(provider.getTransactionById).toHaveBeenCalledTimes(1);
    });

    it('returns null when the receipt cannot be resolved', async () => {
        provider.getTransactionById.mockResolvedValue(rawTransfer(TX_GONE));
        provider.getTransactionInfo.mockResolvedValue(null);

        expect(await service.getTransactionById(TX_GONE)).toBeNull();
    });
});
