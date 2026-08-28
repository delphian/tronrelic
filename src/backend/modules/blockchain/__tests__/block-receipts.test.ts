/**
 * @fileoverview Tests for TronGridClient.getTransactionInfoByBlockNum.
 *
 * Why these exist: this is the call behind the operator switch that turns block
 * receipt enrichment on, and every one of its failure modes is silent. A
 * non-array reply reaching the caller would throw inside the sync loop and push
 * a perfectly good block into the backfill queue; a thrown error escaping this
 * method would do the same; and a receipt list that does not round-trip its `id`
 * would attach energy figures to the wrong transactions, which no downstream
 * check can detect because every value involved is a plausible number.
 *
 * The HTTP layer is mocked so each case states exactly what TronGrid replied.
 * `retry` is stubbed to a single pass because what is under test is this
 * method's handling of the answer, not the shared backoff helper, and the real
 * helper's 750ms–3s delays would put the failure case past the test timeout.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as BSON from 'bson';
import type { Model } from 'mongoose';

vi.mock('../../../lib/http-client.js', () => ({
    httpClient: { post: vi.fn(), get: vi.fn() }
}));

vi.mock('../../../lib/retry.js', () => ({
    retry: <T>(operation: () => Promise<T>): Promise<T> => operation()
}));

import { httpClient } from '../../../lib/http-client.js';
import { TronGridClient } from '../tron-grid.client.js';
import { TransactionModel } from '../../../database/models/transaction-model.js';
import { BlockModel } from '../../../database/models/block-model.js';

/** Block height used throughout; no case depends on its particular value. */
const BLOCK_NUMBER = 85_753_457;

/**
 * Build a receipt entry in the shape `/wallet/gettransactioninfobyblocknum`
 * returns, why: every case varies only the id and the energy figure, so the
 * surrounding envelope is factored out rather than repeated per test.
 *
 * @param id - Transaction hash the entry belongs to, which is the field the
 *             caller joins on.
 * @param energyFee - Energy fee in SUN, as the chain reports it.
 * @returns One `TransactionInfo` entry.
 */
function receipt(id: string, energyFee: number) {
    return {
        id,
        blockNumber: BLOCK_NUMBER,
        blockTimeStamp: 1_787_931_852_000,
        fee: energyFee,
        receipt: { energy_usage_total: energyFee * 2, energy_fee: energyFee, result: 'SUCCESS' }
    };
}

describe('TronGridClient.getTransactionInfoByBlockNum', () => {
    const post = httpClient.post as unknown as ReturnType<typeof vi.fn>;
    let client: TronGridClient;

    beforeEach(() => {
        post.mockReset();
        client = TronGridClient.getInstance();
    });

    it('asks for the whole block once and returns every receipt in it', async () => {
        post.mockResolvedValue({ data: [receipt('tx-a', 288_900), receipt('tx-b', 0)] });

        const infos = await client.getTransactionInfoByBlockNum(BLOCK_NUMBER);

        // One request for the block, not one per transaction — that ratio is the
        // whole reason this endpoint is used instead of gettransactioninfobyid.
        expect(post).toHaveBeenCalledTimes(1);
        expect(post).toHaveBeenCalledWith(
            expect.stringContaining('/wallet/gettransactioninfobyblocknum'),
            { num: BLOCK_NUMBER },
            expect.anything()
        );
        expect(infos.map((info) => info.id)).toEqual(['tx-a', 'tx-b']);
        expect(infos[0].receipt?.energy_fee).toBe(288_900);
    });

    it('returns an empty array when a block with no transactions answers with an object', async () => {
        // TRON answers `{}` rather than `[]` for an empty block. Passing that
        // through would reach a caller that is about to map over it.
        post.mockResolvedValue({ data: {} });

        await expect(client.getTransactionInfoByBlockNum(BLOCK_NUMBER)).resolves.toEqual([]);
    });

    it('returns an empty array rather than throwing when the request fails', async () => {
        // Receipts are enrichment. A block that loses them is still complete and
        // correctly indexed, so a failure here must not fail the block and send it
        // round the backfill queue.
        post.mockRejectedValue(new Error('TronGrid API rate limit exceeded (HTTP 429)'));

        await expect(client.getTransactionInfoByBlockNum(BLOCK_NUMBER)).resolves.toEqual([]);
    });
});

/**
 * Puts an update through the two steps that decide what MongoDB actually stores:
 * Mongoose's schema cast, then BSON serialization.
 *
 * Both steps matter and neither alone is the answer. The cast decides whether a
 * schema default is reinstated, and serialization decides whether an undefined
 * value becomes a stored null or disappears. Asserting on the cast object alone
 * would be misleading, because a key holding `undefined` is still a key in
 * JavaScript while being nothing at all on disk.
 *
 * @param model - The model whose schema does the casting. Generic rather than a
 *                union of the two models used here, because a union of Mongoose
 *                model types makes `where()` unresolvable against its overloads.
 * @param update - The `$set` document the sync pipeline would submit.
 * @returns The document as it would be written, with absent fields genuinely
 *          absent.
 */
function persistedFields<TDoc>(
    model: Model<TDoc>,
    update: Record<string, unknown>
): Record<string, unknown> {
    const query = model.where({ _id: '000000000000000000000000' });
    query.setOptions({ upsert: true });
    query.setUpdate({ $set: update });
    query.cast(model as never);

    const cast = query.getUpdate() as { $set?: Record<string, unknown> };
    const written = BSON.deserialize(BSON.serialize(cast.$set ?? {}));

    return written;
}

describe('what block sync actually persists', () => {
    it('stores no energy or bandwidth field when receipts were not fetched', () => {
        // The "off costs nothing" guarantee rests on an undefined value reaching
        // disk as nothing at all. If a future Mongoose or BSON version stored a
        // null instead, every transaction would quietly gain two null fields and
        // the disabled path would start costing storage with no code change.
        const written = persistedFields(TransactionModel, {
            txId: 'tx-a',
            energy: undefined,
            bandwidth: undefined
        });

        expect(Object.keys(written)).toEqual(['txId']);
    });

    it('stores no internalTransactions field when the transaction triggered none', () => {
        // Omitted rather than `[]`, and no schema default may reinstate it on
        // upsert. That combination is what saves roughly 12 KB per block, and it
        // is only true because both the cast and the serializer drop it.
        const written = persistedFields(TransactionModel, {
            txId: 'tx-a',
            internalTransactions: undefined
        });

        expect(written).not.toHaveProperty('internalTransactions');
        expect(Object.keys(written)).toEqual(['txId']);
    });

    it('still stores internalTransactions when the transaction did trigger some', () => {
        const written = persistedFields(TransactionModel, {
            txId: 'tx-a',
            internalTransactions: [{ hash: 'internal-1' }]
        });

        expect(written.internalTransactions).toHaveLength(1);
    });

    it('stores receiptsFetched on the block document in both states', () => {
        // The flag separates a measured zero from an unmeasured one, so it has to
        // survive as a real boolean rather than being dropped as an unknown path
        // — and `false` in particular must be stored, not treated as empty.
        expect(persistedFields(BlockModel, { receiptsFetched: true })).toEqual({ receiptsFetched: true });
        expect(persistedFields(BlockModel, { receiptsFetched: false })).toEqual({ receiptsFetched: false });
    });
});
