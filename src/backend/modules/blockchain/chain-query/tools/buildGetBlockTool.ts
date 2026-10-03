/**
 * @fileoverview `blockchain-get-block`: one stored block, its header, its totals, and a page of its transactions.
 *
 * Every other chain query tool is keyed by an address, a contract, a
 * transaction id, or a time window, so none can say what one block held, who
 * produced it, or whether it was stored completely. That is the question an
 * operator asks when sync logged a failure for a height, and the one an agent
 * asks when another answer names a block. This tool answers it from the `tron`
 * database alone. It never asks TronGrid, because a read-only tool calling the
 * provider would share block sync's request queue and stop being a read of
 * TronRelic's own copy.
 *
 * Every read is bounded to the one block. `tron.block` is sorted by block
 * number, and `tron.transaction`, `tron.transaction_info`, and
 * `tron.internal_transaction` lead their sort key with it, so each read is a
 * short range. Naming the block's time as well lets ClickHouse open only that
 * day's partition. The per-transaction reads use `LIMIT 1 BY` on each row's
 * identity rather than `FINAL`, the same as `blockchain-transaction-trace`, so
 * a block written twice is still counted once.
 *
 * Internal transactions and receipts are summarised, never listed. A busy
 * block holds thousands of internal transactions, and
 * `blockchain-transaction-trace` already lists one transaction's in full.
 *
 * @module backend/modules/blockchain/chain-query/tools/buildGetBlockTool
 */

import type { IAiTool } from '@/types';
import { toVerifiedBase58 } from '../../../../lib/tron-address.js';
import { CHAIN_DATA_DATABASE } from '../../chain-data/buildChainDataSchema.js';
import { ChainQueryError } from '../ChainQueryError.js';
import { decodeCursor, encodeCursor, parseInteger, retentionStart, type IChainWindow } from '../chainQueryInput.js';
import { buildChainResponse, runChainQueryTool } from '../chainQueryResponse.js';
import type { ChainQuerySession } from '../ChainQuerySession.js';
import type { IChainQueryToolkit } from '../ChainQueryToolkit.js';
import { fromClickHouseTime } from '../clickHouseTime.js';
import { toChainAmount, tokenKey, type IChainTokenInfo } from '../TokenCatalog.js';
import { AI_TOOL_NAMES, CHAIN_QUERY_CAPABILITY, SHARED_DESCRIPTION, TRX_TOKEN, windowParams } from './chainQueryToolShared.js';

/** Transactions listed per page when the caller gives no limit. */
const DEFAULT_LIMIT = 50;

/** Most transactions listed per page. */
const MAX_LIMIT = 200;

/** Most ingest gap records returned for one height. */
const GAP_LIMIT = 5;

/** Longest gap reason returned as is. */
const MAX_TEXT = 500;

/** How long one block's window is for the coverage check: one block time. */
const BLOCK_MS = 3_000;

/** The fields this tool's cursor carries. The block number is kept so a cursor for one block cannot page another. */
const CURSOR_KEYS = ['block', 'index'] as const;

/** The `tron.block` row the header read returns. */
interface IBlockRow {
    block_id: string;
    timestamp: string;
    parent_hash: string;
    tx_trie_root: string;
    witness_address: string;
    witness_id: string | number;
    version: string | number;
    transaction_count: string | number;
    receipts_fetched: string | number;
}

/** One `tron._ingest_gap` row. */
interface IGapRow {
    reason: string;
    recorded_at: string;
}

/** The first and last stored heights, read when the block is not found. */
interface IStoredRangeRow {
    first_block: string | number;
    last_block: string | number;
    present: string | number;
}

/** One group of the transaction count by type and status. */
interface ITypeCountRow {
    contract_type: string;
    contract_ret: string;
    total: string | number;
}

/** One stored receipt, reduced to what the totals and the transaction rows report. */
interface IReceiptRow {
    transaction_index: string | number;
    receipt_result: string;
    fee: string | number;
    energy_total: string | number;
    net_usage: string | number;
}

/** One transaction's internal transaction counts. */
interface IInternalCountRow {
    transaction_index: string | number;
    total: string | number;
    rejected: string | number;
}

/** One `tron.transaction` row on the requested page. */
interface ITransactionRow {
    transaction_index: string | number;
    tx_id: string;
    contract_type: string;
    contract_ret: string;
    owner_hex: string;
    to_hex: string;
    contract_hex: string;
    receiver_hex: string;
    account_hex: string;
}

/**
 * Build the get-block tool.
 *
 * @param toolkit - The shared chain query dependencies.
 * @returns The tool, ready to register.
 */
export function buildGetBlockTool(toolkit: IChainQueryToolkit): IAiTool {
    return {
        name: AI_TOOL_NAMES.getBlock,
        description:
            'Describe one stored TRON block by its number. Returns its header (blockId, parentHash, txTrieRoot, time, producer address and witness id, version), ' +
            'transactionCount as the block reports it beside the number of transactions actually stored, whether its receipts were fetched and how many are stored, ' +
            'totals (internal transactions and how many were rejected, energy used, bandwidth used, TRX burned for fees), transaction counts by contract type and status, ' +
            'any ingest gap records for the height (written when TronRelic failed to store the block; on a found block, one means the block may be stored only in part), and a page of its transactions in chain order with index, txId, type, status, signer, recipient or contract, ' +
            'and, when receipts exist, each transaction\'s receipt result, energy, fee, and internal transaction count. ' +
            `Use to inspect a block another answer named, to check whether a height was stored completely, or to see who produced it. For everything one transaction did, use ${AI_TOOL_NAMES.transactionTrace}; ` +
            `for activity across many blocks, use ${AI_TOOL_NAMES.networkStats}. Event logs are not counted here, because reading them for one block scans its whole day; ${AI_TOOL_NAMES.transactionTrace} with includeEvents reads one transaction's. ` +
            'Parameters: blockNumber (required); limit (transactions per page, default 50, at most 200, 0 for the header and totals only); cursor (pass nextCursor from the previous page to continue). ' +
            'found is false when the block is not stored, and storedRange then says whether the height is older than retention, newer than the newest stored block, or a hole inside the stored data. ' +
            'Receipt-derived figures are null, not zero, when the block was stored without receipts. ' +
            SHARED_DESCRIPTION,
        capability: CHAIN_QUERY_CAPABILITY,
        inputSchema: {
            type: 'object',
            description: 'Which block to describe, and which page of its transactions.',
            properties: {
                blockNumber: { type: 'integer', minimum: 1, description: 'The block height, such as 86774911.' },
                limit: { type: 'integer', minimum: 0, maximum: MAX_LIMIT, description: `Transactions per page. Default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT}. 0 returns the header and totals only.` },
                cursor: { type: 'string', description: 'nextCursor from the previous response, to fetch the next page of transactions. Keep blockNumber the same.' }
            },
            required: ['blockNumber'],
            additionalProperties: false
        },
        inputExamples: [
            { blockNumber: 86774911 },
            { blockNumber: 86774911, limit: 0 },
            { blockNumber: 86774911, limit: 200 }
        ],
        handler: async (input, _principal, context) => runChainQueryTool(toolkit, context, AI_TOOL_NAMES.getBlock, async (session) => {
            const blockNumber = parseInteger(input.blockNumber, 'blockNumber', 0, 1, Number.MAX_SAFE_INTEGER);
            if (blockNumber === 0) {
                throw new ChainQueryError('blockNumber is required: the block height, such as 86774911.', 'input');
            }
            const limit = parseInteger(input.limit, 'limit', DEFAULT_LIMIT, 0, MAX_LIMIT);
            const afterIndex = parseCursor(input.cursor, blockNumber);

            const [block] = await session.query<IBlockRow>(
                `SELECT block_id, timestamp, parent_hash, tx_trie_root, witness_address, witness_id, version, transaction_count,
       toUInt8(_receipts_fetched) AS receipts_fetched
FROM ${CHAIN_DATA_DATABASE}.block FINAL
WHERE block_number = {block:UInt64}
LIMIT 1`,
                { block: blockNumber }
            );
            const gaps = await session.query<IGapRow>(
                `SELECT reason, recorded_at
FROM ${CHAIN_DATA_DATABASE}._ingest_gap
WHERE block_number = {block:UInt64}
ORDER BY recorded_at DESC
LIMIT {limit:UInt32}`,
                { block: blockNumber, limit: GAP_LIMIT }
            );

            return block
                ? describeFound(toolkit, session, blockNumber, block, gaps, limit, afterIndex)
                : describeMissing(toolkit, session, blockNumber, gaps);
        })
    };
}

/**
 * Read a cursor and check it belongs to the block being asked about.
 *
 * @param value - The raw `cursor` argument, possibly absent.
 * @param blockNumber - The block this call is for. A cursor issued for another block would page the wrong transactions.
 * @returns The transaction index the page starts after, or -1 for a first page.
 * @throws ChainQueryError when the cursor was not issued here or was issued for another block.
 */
function parseCursor(value: unknown, blockNumber: number): number {
    const cursor = decodeCursor(value, CURSOR_KEYS);
    let afterIndex = -1;
    if (cursor) {
        const index = Number(cursor.index);
        if (Number(cursor.block) !== blockNumber || !Number.isInteger(index) || index < 0) {
            throw new ChainQueryError('cursor is not one this tool issued for this blockNumber. Pass back nextCursor exactly with the same blockNumber, or omit it.', 'input');
        }
        afterIndex = index;
    }
    return afterIndex;
}

/**
 * Explain a height that has no stored block.
 *
 * A missing block means one of three things, and each needs different
 * advice: the height is older than retention, it has not been written yet (or
 * not produced), or it is a hole inside the stored data. The first and last
 * stored heights tell them apart.
 *
 * @param toolkit - The shared chain query dependencies, for coverage and the clock.
 * @param session - The call's session, so the reads are charged to the run.
 * @param blockNumber - The height that was asked for.
 * @param gaps - Ingest gap records for the height, which explain a hole when there are any.
 * @returns The response.
 */
async function describeMissing(
    toolkit: IChainQueryToolkit,
    session: ChainQuerySession,
    blockNumber: number,
    gaps: IGapRow[]
): Promise<Record<string, unknown>> {
    const now = toolkit.now();
    const retention: IChainWindow = { from: retentionStart(now, toolkit.retentionDays), to: now, clampedToRetention: false };
    // min and max are the same whether or not a block was written twice, so no FINAL.
    const [range] = await session.query<IStoredRangeRow>(
        `SELECT min(block_number) AS first_block, max(block_number) AS last_block, count() AS present
FROM ${CHAIN_DATA_DATABASE}.block
WHERE timestamp >= {from:DateTime64(3, 'UTC')} AND timestamp < {to:DateTime64(3, 'UTC')}`,
        windowParams(retention)
    );
    const present = Number(range?.present ?? 0);
    const first = present > 0 ? Number(range?.first_block) : null;
    const last = present > 0 ? Number(range?.last_block) : null;

    let position: 'no-stored-data' | 'older-than-retention' | 'newer-than-stored' | 'hole';
    let note: string;
    if (first === null || last === null) {
        position = 'no-stored-data';
        note = 'No blocks are stored at all, so nothing can be said about this height.';
    } else if (blockNumber < first) {
        position = 'older-than-retention';
        note = `This height is older than the stored chain data, which keeps ${toolkit.retentionDays} days and starts at block ${first}.`;
    } else if (blockNumber > last) {
        position = 'newer-than-stored';
        note = `This height is above the newest stored block, ${last}. Either it has not been written yet (stored blocks run about a minute behind the chain) or it has not been produced.`;
    } else {
        position = 'hole';
        note = `This height lies inside the stored data (${first} to ${last}) but no block is stored for it, so it is missing.${gaps.length > 0 ? ' ingestGaps records why the write failed.' : ' No ingest gap was recorded, so the cause is unknown here.'}`;
    }

    return buildChainResponse(
        {
            window: retention,
            coverage: await toolkit.coverage.read(session, retention),
            tokens: new Map(),
            tags: await toolkit.tags.lookup([]),
            notes: [note]
        },
        {
            blockNumber,
            found: false,
            storedRange: { firstBlock: first, lastBlock: last, position },
            ingestGaps: describeGaps(gaps)
        }
    );
}

/**
 * Read the rest of a block that was found, and build the response.
 *
 * @param toolkit - The shared chain query dependencies, for TRX metadata, coverage, and tags.
 * @param session - The call's session, so every read is charged to the run's quota and deadline.
 * @param blockNumber - The block's height, which leads the sort key of every table read here.
 * @param block - The header row, whose time names the one partition the other reads open.
 * @param gaps - Ingest gap records for the height. A stored block can still have one, because a batch that wrote some tables and then gave up on another records a gap and is never retried, so the block may be stored only in part.
 * @param limit - How many transactions to list; 0 lists none.
 * @param afterIndex - The transaction index the page starts after, -1 for the first page.
 * @returns The response.
 */
async function describeFound(
    toolkit: IChainQueryToolkit,
    session: ChainQuerySession,
    blockNumber: number,
    block: IBlockRow,
    gaps: IGapRow[],
    limit: number,
    afterIndex: number
): Promise<Record<string, unknown>> {
    const at = { block: blockNumber, blockTime: block.timestamp };
    const atBlock = 'block_number = {block:UInt64} AND block_timestamp = {blockTime:DateTime64(3, \'UTC\')}';
    const receiptsFetched = Number(block.receipts_fetched) === 1;

    const typeCounts = await session.query<ITypeCountRow>(
        `SELECT contract_type, contract_ret, count() AS total
FROM (
    SELECT transaction_index, contract_type, contract_ret
    FROM ${CHAIN_DATA_DATABASE}.transaction
    WHERE ${atBlock}
    LIMIT 1 BY transaction_index
)
GROUP BY contract_type, contract_ret
ORDER BY total DESC, contract_type, contract_ret`,
        at
    );
    // One small row per transaction, so the totals and the page's receipt
    // fields come from one read. A block holds a few thousand transactions at most.
    const receipts = await session.query<IReceiptRow>(
        `SELECT transaction_index, receipt_result, fee, receipt_energy_usage_total AS energy_total, receipt_net_usage AS net_usage
FROM ${CHAIN_DATA_DATABASE}.transaction_info
WHERE ${atBlock}
LIMIT 1 BY transaction_index`,
        at
    );
    const internalCounts = await session.query<IInternalCountRow>(
        `SELECT transaction_index, count() AS total, countIf(rejected) AS rejected
FROM (
    SELECT transaction_index, internal_index, rejected
    FROM ${CHAIN_DATA_DATABASE}.internal_transaction
    WHERE ${atBlock}
    LIMIT 1 BY transaction_index, internal_index
)
GROUP BY transaction_index`,
        at
    );
    // limit + 1 rows, so a further page is known to exist without a count.
    const fetched = limit > 0
        ? await session.query<ITransactionRow>(
            `SELECT transaction_index, tx_id, contract_type, contract_ret,
       JSONExtractString(parameter, 'owner_address') AS owner_hex,
       JSONExtractString(parameter, 'to_address') AS to_hex,
       JSONExtractString(parameter, 'contract_address') AS contract_hex,
       JSONExtractString(parameter, 'receiver_address') AS receiver_hex,
       JSONExtractString(parameter, 'account_address') AS account_hex
FROM ${CHAIN_DATA_DATABASE}.transaction
WHERE ${atBlock} AND transaction_index > {after:Int64}
ORDER BY transaction_index
LIMIT 1 BY transaction_index
LIMIT {limit:UInt32}`,
            { ...at, after: afterIndex, limit: limit + 1 }
        )
        : [];
    const truncated = fetched.length > limit;
    const rows = fetched.slice(0, limit);
    const last = rows[rows.length - 1];

    const tokens = await toolkit.tokens.describe(session, [TRX_TOKEN]);
    const trx = tokens.get(tokenKey(TRX_TOKEN.assetType, TRX_TOKEN.token));
    const receiptByIndex = new Map(receipts.map(row => [Number(row.transaction_index), row]));
    const internalsByIndex = new Map(internalCounts.map(row => [Number(row.transaction_index), row]));
    const transactions = rows.map(row => describeTransaction(row, receiptByIndex, internalsByIndex, receiptsFetched, trx));

    const reported = Number(block.transaction_count);
    const stored = typeCounts.reduce((sum, row) => sum + Number(row.total), 0);
    const time = fromClickHouseTime(block.timestamp);
    const blockStart = new Date(time);
    const window: IChainWindow = { from: blockStart, to: new Date(blockStart.getTime() + BLOCK_MS), clampedToRetention: false };
    const coverage = await toolkit.coverage.read(session, window);
    const tags = await toolkit.tags.lookup([
        block.witness_address,
        ...transactions.flatMap(row => [row.signer, row.to])
    ].filter((address): address is string => Boolean(address)));

    const notes = [
        ...(stored === reported ? [] : [`The block reports ${reported} transactions but ${stored} are stored. The missing ones are absent from every chain query tool.`]),
        ...(receiptsFetched ? [] : ['This block was stored without receipts, so its energy, fees, internal transactions, and each transaction\'s receipt are unknown here, not zero.']),
        ...(receiptsFetched && receipts.length !== stored ? [`Receipts are stored for ${receipts.length} of ${stored} transactions, so the totals are lower bounds.`] : []),
        ...(gaps.length > 0 ? ['ingestGaps lists failed attempts to store this block. The header row is stored, but a write that stored some of the block\'s tables and then gave up on another records a gap and is never retried, so this block may be stored only in part. Treat storedTransactions, storedReceipts, byType, totals, and each transaction\'s receipt and internalTransactions as lower bounds, and do not read a zero among them as proof the block held none.'] : [])
    ];

    return buildChainResponse(
        { window, coverage, tokens, tags, notes },
        {
            blockNumber,
            found: true,
            header: {
                blockId: block.block_id,
                parentHash: block.parent_hash,
                txTrieRoot: block.tx_trie_root,
                time,
                producer: block.witness_address,
                witnessId: Number(block.witness_id),
                version: Number(block.version)
            },
            transactionCount: reported,
            storedTransactions: stored,
            receiptsFetched,
            storedReceipts: receipts.length,
            totals: describeTotals(receipts, internalCounts, receiptsFetched, trx),
            byType: typeCounts.map(row => ({ type: row.contract_type, status: row.contract_ret, count: Number(row.total) })),
            ingestGaps: describeGaps(gaps),
            returned: transactions.length,
            truncated,
            ...(truncated && last ? { nextCursor: encodeCursor({ block: blockNumber, index: Number(last.transaction_index) }) } : {}),
            transactions
        }
    );
}

/**
 * Add up the receipt-derived totals for the block.
 *
 * @param receipts - Every stored receipt in the block.
 * @param internalCounts - Every transaction's internal transaction counts.
 * @param receiptsFetched - Whether the block was stored with receipts. Without them the totals are unknown, so they are null rather than a misleading zero.
 * @param trx - TRX's metadata, for converting the SUN fee total.
 * @returns The totals object.
 */
function describeTotals(
    receipts: IReceiptRow[],
    internalCounts: IInternalCountRow[],
    receiptsFetched: boolean,
    trx: IChainTokenInfo | undefined
): Record<string, unknown> {
    let totals: Record<string, unknown> = {
        internalTransactions: null,
        rejectedInternalTransactions: null,
        energyUsed: null,
        bandwidthUsed: null,
        trxBurnedForFees: null
    };
    if (receiptsFetched) {
        /**
         * Add up one integer column. ClickHouse sends 64-bit integers as
         * strings, and BigInt keeps a block of large fees from losing precision.
         *
         * @param values - The column's values, one per receipt or transaction.
         * @returns Their sum.
         */
        const sum = (values: Array<string | number>): bigint => values.reduce<bigint>((total, value) => total + BigInt(value), 0n);
        totals = {
            internalTransactions: Number(sum(internalCounts.map(row => row.total))),
            rejectedInternalTransactions: Number(sum(internalCounts.map(row => row.rejected))),
            energyUsed: Number(sum(receipts.map(row => row.energy_total))),
            bandwidthUsed: Number(sum(receipts.map(row => row.net_usage))),
            trxBurnedForFees: toChainAmount(sum(receipts.map(row => row.fee)).toString(), trx)
        };
    }
    return totals;
}

/**
 * Turn one page row into the response's transaction entry.
 *
 * The recipient is whichever party field the contract type carries:
 * `to_address` for transfers, `contract_address` for contract calls,
 * `receiver_address` for delegations, and `account_address` for account
 * creation. A type with none of them, such as a vote, has no recipient.
 *
 * @param row - The transaction row.
 * @param receiptByIndex - Stored receipts by transaction index.
 * @param internalsByIndex - Internal transaction counts by transaction index.
 * @param receiptsFetched - Whether the block has receipts, which decides between a missing receipt and an unknown one.
 * @param trx - TRX's metadata, for converting the fee.
 * @returns The entry.
 */
function describeTransaction(
    row: ITransactionRow,
    receiptByIndex: Map<number, IReceiptRow>,
    internalsByIndex: Map<number, IInternalCountRow>,
    receiptsFetched: boolean,
    trx: IChainTokenInfo | undefined
): { index: number; txId: string; type: string; status: string; signer: string | null; to: string | null; receipt: Record<string, unknown> | null } {
    const index = Number(row.transaction_index);
    const receipt = receiptByIndex.get(index);
    const internals = internalsByIndex.get(index);
    const target = row.to_hex || row.contract_hex || row.receiver_hex || row.account_hex;
    return {
        index,
        txId: row.tx_id,
        type: row.contract_type,
        status: row.contract_ret,
        signer: toAddress(row.owner_hex),
        to: toAddress(target),
        receipt: receiptsFetched && receipt
            ? {
                result: receipt.receipt_result,
                energyUsed: Number(receipt.energy_total),
                fee: toChainAmount(String(receipt.fee), trx),
                internalTransactions: Number(internals?.total ?? 0)
            }
            : null
    };
}

/**
 * Turn ingest gap rows into the response's `ingestGaps` list.
 *
 * @param gaps - The rows, newest first.
 * @returns Each record's reason, cut to a safe length, and when it was written.
 */
function describeGaps(gaps: IGapRow[]): Array<{ reason: string; recordedAt: string }> {
    return gaps.map(row => ({
        reason: row.reason.length > MAX_TEXT ? `${row.reason.slice(0, MAX_TEXT)}… (${row.reason.length} characters)` : row.reason,
        recordedAt: fromClickHouseTime(row.recorded_at)
    }));
}

/**
 * Convert a hex address from a stored parameter into base58.
 *
 * @param value - The stored value, normally `41` followed by 40 hex characters, or empty when the field is absent.
 * @returns The base58 address, or null when the value is empty or not an address.
 */
function toAddress(value: string): string | null {
    return value ? toVerifiedBase58(value) : null;
}
