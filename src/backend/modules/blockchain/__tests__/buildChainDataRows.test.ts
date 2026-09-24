/**
 * Unit tests for turning a fetched block into rows for the ClickHouse `tron` tables.
 *
 * The mapper is the one place java-tron's JSON becomes the schema's columns, so
 * two kinds of mistake matter and both are silent in production. A default
 * written wrongly — an empty `resource` where java-tron meant BANDWIDTH — stores
 * a confident wrong answer. And a column the mapper writes that the schema does
 * not declare makes ClickHouse reject the whole insert, which the writer then
 * records as a gap on every block. The last group of tests holds the mapper and
 * the schema to the same column names so that second mistake fails here instead.
 */
import { describe, it, expect } from 'vitest';
import type { TronGridBlock, TronGridTransaction, TronGridTransactionInfo } from '../tron-grid.client.js';
import { buildChainDataRows, listMappedContractTypes, type ChainDataRow } from '../chain-data/buildChainDataRows.js';
import { buildChainDataSchema, CONTRACT_TABLE_SPECS, contractTableName } from '../chain-data/buildChainDataSchema.js';

/** The USDT contract, in java-tron's hex form and in base58. */
const USDT_HEX = '41a614f803b6fd780986a42c78ec9c7f77e6ded13c';
const USDT_BASE58 = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

/** The all-zero address, in java-tron's hex form and in base58. */
const ZERO_HEX = '410000000000000000000000000000000000000000';
const ZERO_BASE58 = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';

/** A fixed block time, so every formatted timestamp is predictable. */
const BLOCK_TIME = new Date(Date.UTC(2026, 8, 24, 3, 12, 36, 0));

/** The height every test block is requested at and carries in its header. */
const BLOCK_NUMBER = 86_515_073;

/**
 * Build a transaction carrying one contract of the given type.
 *
 * @param txID - The transaction id, which the receipts join on.
 * @param type - The java-tron contract type.
 * @param value - The contract's parameter value.
 * @param extras - Fields to add or override on the transaction.
 * @returns A transaction in the shape `getblockbynum` returns.
 */
function buildTransaction(
    txID: string,
    type: string,
    value: Record<string, unknown>,
    extras: Partial<TronGridTransaction> = {}
): TronGridTransaction {
    return {
        txID,
        raw_data: {
            timestamp: BLOCK_TIME.getTime(),
            expiration: BLOCK_TIME.getTime() + 60_000,
            ref_block_bytes: 'abcd',
            ref_block_hash: '0011223344556677',
            contract: [{ type, parameter: { value, type_url: `type.googleapis.com/protocol.${type}` } }]
        },
        raw_data_hex: `raw-${txID}`,
        signature: [`sig-${txID}`],
        ret: [{ contractRet: 'SUCCESS', fee: 0 }],
        ...extras
    };
}

/**
 * Build a block holding the given transactions.
 *
 * @param transactions - The block's transactions, in chain order.
 * @returns A block in the shape `getblockbynum` returns.
 */
function buildBlock(transactions: TronGridTransaction[]): TronGridBlock {
    return {
        blockID: 'block-id',
        block_header: {
            raw_data: {
                number: BLOCK_NUMBER,
                timestamp: BLOCK_TIME.getTime(),
                parentHash: 'parent-hash',
                witness_address: ZERO_HEX,
                txTrieRoot: 'trie-root',
                version: 34
            },
            witness_signature: 'witness-sig'
        },
        transactions
    };
}

/**
 * Split a column list on the commas between columns, leaving the commas inside
 * a `Nested(…)` or `Map(…)` type alone.
 *
 * @param body - The text between a `CREATE TABLE`'s outer parentheses.
 * @returns One entry per column or index definition.
 */
function splitTopLevel(body: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let current = '';
    for (const character of body) {
        if (character === '(') depth += 1;
        if (character === ')') depth -= 1;
        if (character === ',' && depth === 0) {
            parts.push(current);
            current = '';
        } else {
            current += character;
        }
    }
    parts.push(current);
    return parts.map(part => part.trim()).filter(part => part.length > 0);
}

/**
 * Read the column names a table's `CREATE TABLE` statement declares.
 *
 * A `Nested` column is expanded into the dotted names ClickHouse stores it
 * under, which are the names the mapper writes.
 *
 * @param table - The table name without its database.
 * @returns Every declared column name.
 */
function declaredColumns(table: string): Set<string> {
    const statement = buildChainDataSchema(7).find(candidate => candidate.includes(`tron.${table} (`));
    if (!statement) {
        throw new Error(`No CREATE TABLE statement for ${table}`);
    }
    // The column list runs from the first parenthesis to the one that closes it,
    // not to the statement's last parenthesis, which belongs to ORDER BY.
    const start = statement.indexOf('(');
    let end = start;
    for (let depth = 0; end < statement.length; end += 1) {
        if (statement[end] === '(') depth += 1;
        if (statement[end] === ')') depth -= 1;
        if (depth === 0) break;
    }
    const names = new Set<string>();
    for (const definition of splitTopLevel(statement.slice(start + 1, end))) {
        if (definition.startsWith('INDEX ')) continue;
        const [name] = definition.split(/\s+/);
        const nested = /^(\w+)\s+Nested\((.*)\)$/s.exec(definition);
        if (nested) {
            for (const field of splitTopLevel(nested[2])) {
                names.add(`${nested[1]}.${field.split(/\s+/)[0]}`);
            }
        } else {
            names.add(name);
        }
    }
    return names;
}

describe('buildChainDataRows', () => {
    it('describes the block itself with base58 addresses and the receipt flag', () => {
        const rows = buildChainDataRows({ block: buildBlock([]), receipts: [], blockNumber: BLOCK_NUMBER, blockTime: BLOCK_TIME, receiptsFetched: true });

        expect(rows.blockNumber).toBe(BLOCK_NUMBER);
        expect(rows.tables.block).toEqual([expect.objectContaining({
            block_number: BLOCK_NUMBER,
            block_id: 'block-id',
            timestamp: '2026-09-24 03:12:36.000',
            witness_address: ZERO_BASE58,
            tx_trie_root: 'trie-root',
            version: 34,
            transaction_count: 0,
            _receipts_fetched: true
        })]);
    });

    it('takes the block number from the requested height, not the response header', () => {
        const block = buildBlock([
            buildTransaction('tx-a', 'TransferContract', { owner_address: ZERO_HEX, to_address: USDT_HEX, amount: 1 })
        ]);
        // java-tron omits a header field at its default, so the header number can be absent.
        block.block_header.raw_data.number = undefined as unknown as number;

        const rows = buildChainDataRows({ block, receipts: [], blockNumber: BLOCK_NUMBER, blockTime: BLOCK_TIME, receiptsFetched: false });

        expect(rows.blockNumber).toBe(BLOCK_NUMBER);
        expect(rows.tables.block[0].block_number).toBe(BLOCK_NUMBER);
        expect(rows.tables.transaction[0].block_number).toBe(BLOCK_NUMBER);
        expect(rows.tables.transfer_contract[0].block_number).toBe(BLOCK_NUMBER);
    });

    it('keeps every transaction, its position, and its exact signed bytes', () => {
        const block = buildBlock([
            buildTransaction('tx-a', 'TransferContract', { owner_address: ZERO_HEX, to_address: USDT_HEX, amount: 5_000_000 }),
            buildTransaction('tx-b', 'CancelAllUnfreezeV2Contract', { owner_address: ZERO_HEX })
        ]);

        const rows = buildChainDataRows({ block, receipts: [], blockNumber: BLOCK_NUMBER, blockTime: BLOCK_TIME, receiptsFetched: false });

        expect(rows.tables.transaction).toHaveLength(2);
        expect(rows.tables.transaction[1]).toEqual(expect.objectContaining({
            tx_id: 'tx-b',
            transaction_index: 1,
            contract_type: 'CancelAllUnfreezeV2Contract',
            parameter: JSON.stringify({ owner_address: ZERO_HEX }),
            raw_data_hex: 'raw-tx-b',
            signature: ['sig-tx-b'],
            contract_ret: 'SUCCESS',
            permission_id: 0
        }));
    });

    it('writes a typed contract row only for types that have a table', () => {
        // A type without a table still lands in tron.transaction, so nothing is
        // lost; it simply has no typed row.
        const block = buildBlock([
            buildTransaction('tx-a', 'TransferContract', { owner_address: ZERO_HEX, to_address: USDT_HEX, amount: 5_000_000 }),
            buildTransaction('tx-b', 'CancelAllUnfreezeV2Contract', { owner_address: ZERO_HEX })
        ]);

        const rows = buildChainDataRows({ block, receipts: [], blockNumber: BLOCK_NUMBER, blockTime: BLOCK_TIME, receiptsFetched: false });

        expect(rows.tables.transfer_contract).toEqual([expect.objectContaining({
            tx_id: 'tx-a',
            owner_address: ZERO_BASE58,
            to_address: USDT_BASE58,
            amount: 5_000_000
        })]);
        expect(rows.tables.cancel_all_unfreeze_v2_contract).toBeUndefined();
    });

    it('stores the protobuf default where java-tron omitted a field', () => {
        // java-tron leaves a field out at its default, so a delegation with no
        // resource is BANDWIDTH. An empty string would read as unknown.
        const block = buildBlock([
            buildTransaction('tx-a', 'DelegateResourceContract', {
                owner_address: ZERO_HEX,
                receiver_address: USDT_HEX,
                balance: 219_000_000
            }, { ret: [{ contractRet: 'SUCCESS', fee: 0 }] })
        ]);
        block.transactions![0].raw_data.contract[0].Permission_id = 3;

        const rows = buildChainDataRows({ block, receipts: [], blockNumber: BLOCK_NUMBER, blockTime: BLOCK_TIME, receiptsFetched: false });

        expect(rows.tables.delegate_resource_contract).toEqual([expect.objectContaining({
            resource: 'BANDWIDTH',
            lock: false,
            lock_period: 0,
            permission_id: 3,
            receiver_address: USDT_BASE58
        })]);
    });

    it('joins receipts to their transactions by id and takes their positions', () => {
        const block = buildBlock([
            buildTransaction('tx-a', 'TransferContract', { owner_address: ZERO_HEX, to_address: USDT_HEX, amount: 1 }),
            buildTransaction('tx-b', 'TriggerSmartContract', { owner_address: ZERO_HEX, contract_address: USDT_HEX, data: 'a9059cbb' })
        ]);
        const receipts: TronGridTransactionInfo[] = [{
            id: 'tx-b',
            fee: 345_000,
            blockNumber: BLOCK_NUMBER,
            blockTimeStamp: BLOCK_TIME.getTime(),
            receipt: { energy_usage_total: 64_285, result: 'SUCCESS' },
            log: [{
                address: 'a614f803b6fd780986a42c78ec9c7f77e6ded13c',
                topics: ['ddf252ad', 'from', 'to'],
                data: '00ff'
            }],
            internal_transactions: [{
                hash: 'internal-hash',
                caller_address: USDT_HEX,
                transferTo_address: ZERO_HEX,
                callValueInfo: [{ callValue: 10 }, { tokenId: '1002000', callValue: 5 }],
                note: '63616c6c'
            }],
            cancel_unfreezeV2_amount: [{ key: 'ENERGY', value: 7 }]
        }, {
            id: 'not-in-block',
            fee: 1,
            blockNumber: BLOCK_NUMBER,
            blockTimeStamp: BLOCK_TIME.getTime()
        }];

        const rows = buildChainDataRows({ block, receipts, blockNumber: BLOCK_NUMBER, blockTime: BLOCK_TIME, receiptsFetched: true });

        // A receipt whose transaction is not in the block has no position to take.
        expect(rows.tables.transaction_info).toHaveLength(1);
        expect(rows.tables.transaction_info[0]).toEqual(expect.objectContaining({
            tx_id: 'tx-b',
            transaction_index: 1,
            fee: 345_000,
            result: 'SUCESS',
            receipt_energy_usage_total: 64_285,
            receipt_result: 'SUCCESS',
            cancel_unfreeze_v2_amount: { ENERGY: 7 }
        }));
        expect(rows.tables.log).toEqual([expect.objectContaining({
            tx_id: 'tx-b',
            log_index: 0,
            address: USDT_BASE58,
            topics: ['ddf252ad', 'from', 'to'],
            _topic0: 'ddf252ad'
        })]);
        expect(rows.tables.internal_transaction).toEqual([expect.objectContaining({
            internal_index: 0,
            caller_address: USDT_BASE58,
            transfer_to_address: ZERO_BASE58,
            'call_value_info.call_value': [10, 5],
            'call_value_info.token_id': ['', '1002000'],
            rejected: false
        })]);
    });

    it('passes an int64 beyond 2^53 through as exact text, and drops one ClickHouse would wrap', () => {
        const block = buildBlock([
            // The exact-integer parser delivers a value beyond 2^53 as its decimal text.
            buildTransaction('tx-a', 'TransferAssetContract', { owner_address: ZERO_HEX, to_address: USDT_HEX, asset_name: '31303030303031', amount: '9223372036854775807' }),
            buildTransaction('tx-b', 'TransferAssetContract', { owner_address: ZERO_HEX, to_address: USDT_HEX, asset_name: '31303030303031', amount: '9223372036854775808' }),
            buildTransaction('tx-c', 'TransferAssetContract', { owner_address: ZERO_HEX, to_address: USDT_HEX, asset_name: '31303030303031', amount: '5000' })
        ]);

        const rows = buildChainDataRows({ block, receipts: [], blockNumber: BLOCK_NUMBER, blockTime: BLOCK_TIME, receiptsFetched: false });

        expect(rows.tables.transfer_asset_contract.map(row => row.amount)).toEqual(['9223372036854775807', 0, 5000]);
    });

    it('keeps an address that will not convert rather than dropping it', () => {
        const block = buildBlock([
            buildTransaction('tx-a', 'TransferContract', { owner_address: 'not-an-address', to_address: USDT_HEX, amount: 1 })
        ]);

        const rows = buildChainDataRows({ block, receipts: [], blockNumber: BLOCK_NUMBER, blockTime: BLOCK_TIME, receiptsFetched: false });

        expect(rows.tables.transfer_contract[0].owner_address).toBe('not-an-address');
    });

    it('flattens a vote list into the Nested columns ClickHouse stores', () => {
        const block = buildBlock([
            buildTransaction('tx-a', 'VoteWitnessContract', {
                owner_address: ZERO_HEX,
                votes: [{ vote_address: USDT_HEX, vote_count: 100 }]
            })
        ]);

        const rows = buildChainDataRows({ block, receipts: [], blockNumber: BLOCK_NUMBER, blockTime: BLOCK_TIME, receiptsFetched: false });

        expect(rows.tables.vote_witness_contract[0]).toEqual(expect.objectContaining({
            'votes.vote_address': [USDT_BASE58],
            'votes.vote_count': [100],
            support: false
        }));
    });
});

describe('chain data rows agree with the schema', () => {
    /**
     * Assert that every column a row carries is one its table declares, apart
     * from the two bookkeeping columns the writer adds at insert time.
     *
     * @param table - The table the rows are bound for.
     * @param rows - The rows the mapper built.
     */
    function expectDeclared(table: string, rows: ChainDataRow[]): void {
        const declared = declaredColumns(table);
        for (const row of rows) {
            for (const column of Object.keys(row)) {
                expect(declared, `${table}.${column}`).toContain(column);
            }
        }
    }

    it('names a column reader for exactly the contract types that have a table', () => {
        expect(listMappedContractTypes().sort()).toEqual(CONTRACT_TABLE_SPECS.map(spec => spec.contractType).sort());
    });

    it('writes only declared columns, for every table', () => {
        const transactions = CONTRACT_TABLE_SPECS.map((spec, index) =>
            buildTransaction(`tx-${index}`, spec.contractType, { owner_address: ZERO_HEX })
        );
        const receipts: TronGridTransactionInfo[] = [{
            id: 'tx-0',
            fee: 1,
            blockNumber: BLOCK_NUMBER,
            blockTimeStamp: BLOCK_TIME.getTime(),
            log: [{ address: USDT_HEX.slice(2), topics: ['t0'], data: '' }],
            internal_transactions: [{ hash: 'h', callValueInfo: [{ callValue: 1 }] }]
        }];

        const rows = buildChainDataRows({ block: buildBlock(transactions), receipts, blockNumber: BLOCK_NUMBER, blockTime: BLOCK_TIME, receiptsFetched: true });

        for (const [table, tableRows] of Object.entries(rows.tables)) {
            expect(tableRows.length, `${table} should have a row to check`).toBeGreaterThan(0);
            expectDeclared(table, tableRows);
        }
    });

    it('converts contract type names into table names mechanically', () => {
        expect(contractTableName('UnDelegateResourceContract')).toBe('un_delegate_resource_contract');
        expect(contractTableName('FreezeBalanceV2Contract')).toBe('freeze_balance_v2_contract');
        expect(contractTableName('TriggerSmartContract')).toBe('trigger_smart_contract');
    });
});
