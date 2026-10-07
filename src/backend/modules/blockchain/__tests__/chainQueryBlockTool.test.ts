/**
 * Unit tests for `blockchain-get-block`, run against a fake ClickHouse reader.
 *
 * They pin what the tool promises the model: a stored block comes back with
 * its header, totals, and a page of transactions; receipt figures are null
 * rather than zero when the block has no receipts; a height with no stored
 * block says whether it is too old, too new, or a hole; every per-transaction
 * read is bounded to the one block without `FINAL`; and a bad argument or a
 * cursor from another block is refused before any query runs.
 */
import { describe, it, expect } from 'vitest';
import { toHexAddress } from '../../../lib/tron-address.js';
import { buildGetBlockTool } from '../chain-query/tools/buildGetBlockTool.js';
import { buildToolkit, CONTEXT, PEER, USDT, WALLET, type QueryHandler } from './chainQueryTestToolkit.js';

/** The block every found-block test asks for. */
const BLOCK = 29000;

/** The stored time of {@link BLOCK}, inside the fake toolkit's retention. */
const BLOCK_TIME = '2026-09-24 11:00:00.000';

/** The fake toolkit's coverage answer covers blocks 1000 to 29799, so this height is inside it. */
const HOLE = 20000;

/**
 * The answers a stored block's reads get, keyed by which read each query is.
 *
 * @param options - Whether the block has receipts, and which stored transactions the page read returns.
 * @returns A query handler for {@link buildToolkit}.
 */
function storedBlock(options: { receiptsFetched: boolean; pageRows?: Array<Record<string, unknown>> }): QueryHandler {
    return (sql) => {
        let rows: unknown[] = [];
        if (sql.includes('tron.block FINAL') && sql.includes('block_id')) {
            rows = [{
                block_id: '00'.repeat(32),
                timestamp: BLOCK_TIME,
                parent_hash: '11'.repeat(32),
                tx_trie_root: '22'.repeat(32),
                witness_address: PEER,
                witness_id: '7',
                version: '32',
                transaction_count: '2',
                receipts_fetched: options.receiptsFetched ? 1 : 0
            }];
        } else if (sql.includes('GROUP BY contract_type')) {
            rows = [
                { contract_type: 'TriggerSmartContract', contract_ret: 'SUCCESS', total: '1' },
                { contract_type: 'TransferContract', contract_ret: 'SUCCESS', total: '1' }
            ];
        } else if (sql.includes('tron.transaction_info')) {
            rows = options.receiptsFetched
                ? [
                    { transaction_index: '0', receipt_result: 'SUCCESS', fee: '345000', energy_total: '29631', net_usage: '345' },
                    { transaction_index: '1', receipt_result: 'DEFAULT', fee: '0', energy_total: '0', net_usage: '268' }
                ]
                : [];
        } else if (sql.includes('tron.internal_transaction')) {
            rows = options.receiptsFetched ? [{ transaction_index: '0', total: '3', rejected: '1' }] : [];
        } else if (sql.includes('JSONExtractString(parameter')) {
            rows = options.pageRows ?? pageRows();
        }
        return rows;
    };
}

/**
 * The two stored transactions of the test block, in chain order.
 *
 * @returns The rows as the page read returns them, with addresses in the hex form parameters store.
 */
function pageRows(): Array<Record<string, unknown>> {
    return [
        {
            transaction_index: '0', tx_id: 'aa'.repeat(32), contract_type: 'TriggerSmartContract', contract_ret: 'SUCCESS',
            owner_hex: toHexAddress(WALLET), to_hex: '', contract_hex: toHexAddress(USDT), receiver_hex: '', account_hex: ''
        },
        {
            transaction_index: '1', tx_id: 'bb'.repeat(32), contract_type: 'TransferContract', contract_ret: 'SUCCESS',
            owner_hex: toHexAddress(WALLET), to_hex: toHexAddress(PEER), contract_hex: '', receiver_hex: '', account_hex: ''
        }
    ];
}

describe('blockchain-get-block', () => {
    it('describes a stored block: header, totals, counts by type, and its transactions with receipts', async () => {
        const { toolkit, reads } = buildToolkit(storedBlock({ receiptsFetched: true }));

        const result = await buildGetBlockTool(toolkit).handler({ blockNumber: BLOCK }, undefined, CONTEXT) as Record<string, unknown>;

        expect(result).toEqual(expect.objectContaining({
            success: true,
            found: true,
            blockNumber: BLOCK,
            transactionCount: 2,
            storedTransactions: 2,
            receiptsFetched: true,
            storedReceipts: 2,
            truncated: false
        }));
        expect(result.header).toEqual(expect.objectContaining({ blockId: '00'.repeat(32), producer: PEER, time: '2026-09-24T11:00:00.000Z' }));
        expect(result.totals).toEqual({
            internalTransactions: 3,
            rejectedInternalTransactions: 1,
            energyUsed: 29631,
            bandwidthUsed: 613,
            trxBurnedForFees: expect.objectContaining({ raw: '345000' })
        });
        expect(result.byType).toEqual([
            { type: 'TriggerSmartContract', status: 'SUCCESS', count: 1 },
            { type: 'TransferContract', status: 'SUCCESS', count: 1 }
        ]);
        const transactions = result.transactions as Array<Record<string, unknown>>;
        expect(transactions[0]).toEqual(expect.objectContaining({
            index: 0,
            account: WALLET,
            to: USDT,
            receipt: expect.objectContaining({ result: 'SUCCESS', energyUsed: 29631, internalTransactions: 3 })
        }));
        expect(transactions[1]).toEqual(expect.objectContaining({ to: PEER, receipt: expect.objectContaining({ internalTransactions: 0 }) }));
        expect(result.addressTags).toEqual({ [PEER]: ['ofac:sdn'], [USDT]: ['token:usdt'] });

        // Every per-transaction read is bounded to the block and its day, without FINAL.
        const ownReads = reads.filter(entry => /tron\.(transaction|transaction_info|internal_transaction)\b/.test(entry.sql));
        expect(ownReads.length).toBe(4);
        for (const read of ownReads) {
            expect(read.sql).not.toContain('FINAL');
            expect(read.params).toEqual(expect.objectContaining({ block: BLOCK, blockTime: BLOCK_TIME }));
            expect(read.sql).not.toContain(String(BLOCK));
        }
        expect(reads.every(read => read.quotaKey === 'run-1')).toBe(true);
    });

    it('reports receipt figures as null, not zero, for a block stored without receipts', async () => {
        const { toolkit } = buildToolkit(storedBlock({ receiptsFetched: false }));

        const result = await buildGetBlockTool(toolkit).handler({ blockNumber: BLOCK }, undefined, CONTEXT) as Record<string, unknown>;

        expect(result.totals).toEqual({
            internalTransactions: null,
            rejectedInternalTransactions: null,
            energyUsed: null,
            bandwidthUsed: null,
            trxBurnedForFees: null
        });
        expect((result.transactions as Array<Record<string, unknown>>).every(row => row.receipt === null)).toBe(true);
        expect((result.notes as string[]).some(note => note.includes('stored without receipts'))).toBe(true);
    });

    it('pages transactions with a cursor that continues after the last index', async () => {
        const { toolkit, reads } = buildToolkit(storedBlock({ receiptsFetched: true }));
        const tool = buildGetBlockTool(toolkit);

        const first = await tool.handler({ blockNumber: BLOCK, limit: 1 }, undefined, CONTEXT) as Record<string, unknown>;
        expect(first).toEqual(expect.objectContaining({ returned: 1, truncated: true }));

        await tool.handler({ blockNumber: BLOCK, limit: 1, cursor: first.nextCursor }, undefined, CONTEXT);
        const pageRead = reads.filter(entry => entry.sql.includes('JSONExtractString(parameter')).pop();
        expect(pageRead?.params).toEqual(expect.objectContaining({ after: 0, limit: 2 }));
    });

    it('skips the transaction list when limit is 0', async () => {
        const { toolkit, reads } = buildToolkit(storedBlock({ receiptsFetched: true }));

        const result = await buildGetBlockTool(toolkit).handler({ blockNumber: BLOCK, limit: 0 }, undefined, CONTEXT) as Record<string, unknown>;

        expect(result).toEqual(expect.objectContaining({ found: true, returned: 0, transactions: [] }));
        expect(reads.some(entry => entry.sql.includes('JSONExtractString(parameter'))).toBe(false);
    });

    it('notes a block whose stored transactions fall short of its reported count', async () => {
        const handler = storedBlock({ receiptsFetched: true });
        const { toolkit } = buildToolkit((sql, params) => (
            sql.includes('GROUP BY contract_type')
                ? [{ contract_type: 'TransferContract', contract_ret: 'SUCCESS', total: '1' }]
                : handler(sql, params)
        ));

        const result = await buildGetBlockTool(toolkit).handler({ blockNumber: BLOCK }, undefined, CONTEXT) as Record<string, unknown>;

        expect(result).toEqual(expect.objectContaining({ transactionCount: 2, storedTransactions: 1 }));
        expect((result.notes as string[]).some(note => note.includes('reports 2 transactions but 1 are stored'))).toBe(true);
    });

    it('explains a missing height inside the stored data as a hole, with its gap record', async () => {
        const { toolkit } = buildToolkit((sql) => {
            let rows: unknown[] = [];
            if (sql.includes('_ingest_gap')) {
                rows = [{ reason: 'ClickHouse insert failed after 3 attempts', recorded_at: '2026-09-24 10:00:00.000' }];
            } else if (sql.includes('first_block') && !sql.includes('FINAL')) {
                rows = [{ first_block: '1000', last_block: '29799', present: '28799' }];
            }
            return rows;
        });

        const result = await buildGetBlockTool(toolkit).handler({ blockNumber: HOLE }, undefined, CONTEXT) as Record<string, unknown>;

        expect(result).toEqual(expect.objectContaining({
            success: true,
            found: false,
            storedRange: { firstBlock: 1000, lastBlock: 29799, position: 'hole' },
            ingestGaps: [{ reason: 'ClickHouse insert failed after 3 attempts', recordedAt: '2026-09-24T10:00:00.000Z' }]
        }));
    });

    it('tells a height older than retention from one not written yet', async () => {
        const { toolkit } = buildToolkit((sql) => (
            sql.includes('first_block') && !sql.includes('FINAL') ? [{ first_block: '1000', last_block: '29799', present: '28800' }] : []
        ));
        const tool = buildGetBlockTool(toolkit);

        const old = await tool.handler({ blockNumber: 999 }, undefined, CONTEXT) as Record<string, unknown>;
        const future = await tool.handler({ blockNumber: 30000 }, undefined, CONTEXT) as Record<string, unknown>;

        expect((old.storedRange as Record<string, unknown>).position).toBe('older-than-retention');
        expect((future.storedRange as Record<string, unknown>).position).toBe('newer-than-stored');
    });

    it('refuses a bad blockNumber, or a cursor from another block, before running any query', async () => {
        const { toolkit, reads } = buildToolkit(storedBlock({ receiptsFetched: true }));
        const tool = buildGetBlockTool(toolkit);
        const first = await tool.handler({ blockNumber: BLOCK, limit: 1 }, undefined, CONTEXT) as Record<string, unknown>;
        reads.length = 0;

        const missing = await tool.handler({}, undefined, CONTEXT) as Record<string, unknown>;
        const fractional = await tool.handler({ blockNumber: 1.5 }, undefined, CONTEXT) as Record<string, unknown>;
        const negative = await tool.handler({ blockNumber: -3 }, undefined, CONTEXT) as Record<string, unknown>;
        const otherBlock = await tool.handler({ blockNumber: BLOCK + 1, cursor: first.nextCursor }, undefined, CONTEXT) as Record<string, unknown>;

        for (const result of [missing, fractional, negative, otherBlock]) {
            expect(result).toEqual(expect.objectContaining({ success: false, errorKind: 'input' }));
        }
        expect(reads).toHaveLength(0);
    });
});
