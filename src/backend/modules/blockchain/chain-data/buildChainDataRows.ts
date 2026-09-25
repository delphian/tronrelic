/**
 * @fileoverview Turning one fetched block into rows for the ClickHouse `tron` tables.
 *
 * A pure translation from java-tron's JSON, as `getblockbynum` and
 * `gettransactioninfobyblocknum` return it, into one row per table the schema in
 * `buildChainDataSchema.ts` defines. It performs no I/O, so sync can build the rows
 * while it prepares a block and the writer only has to send them.
 *
 * Three rules hold throughout, each from the schema document:
 * - Addresses are stored in base58, converted from java-tron's hex form. A value
 *   that will not convert is stored as it arrived rather than dropped, because a
 *   raw hex address is still evidence and an empty one is not.
 * - Other bytes stay lowercase hex as the API returns them.
 * - A field java-tron left out of its JSON is written as the protobuf default,
 *   because java-tron omits defaults: a delegation with no `resource` is
 *   BANDWIDTH, and storing an empty string there would read as a missing value.
 *
 * @module backend/modules/blockchain/chain-data/buildChainDataRows
 */

import { toBase58Address } from '../../../lib/tron-address.js';
import { formatClickHouseDateTime64Utc } from '../../../lib/formatClickHouseDateTime64Utc.js';
import type { TronGridBlock, TronGridTransaction, TronGridTransactionInfo } from '../tron-grid.client.js';
import { CONTRACT_TABLE_SPECS, contractTableName, TRANSFER_TABLE } from './buildChainDataSchema.js';
import { buildTransferRows } from './buildTransferRows.js';

/** One row bound for one table, keyed by column name. */
export type ChainDataRow = Record<string, unknown>;

/**
 * Everything one block contributes to the `tron` tables.
 *
 * Built while the block is prepared and carried with it through the playout
 * buffer, so the rows written at commit describe exactly the block that was
 * committed.
 */
export interface IChainDataRows {
    /** Height of the block the rows describe. */
    blockNumber: number;
    /** The block's own time, already in ClickHouse's datetime form. */
    blockTimestamp: string;
    /** Rows per table, keyed by the table name without its database. */
    tables: Record<string, ChainDataRow[]>;
    /**
     * Why the rows could not be built, when they could not.
     *
     * A block whose rows failed to build is still committed to MongoDB and still
     * reaches observers; it is only missing from ClickHouse. Carrying the reason
     * to the writer is what lets it record that absence as a gap instead of
     * leaving a hole nobody can tell from a quiet block.
     */
    failure?: string;
}

/** What the mapper needs to describe one block. */
export interface IChainDataRowsInput {
    /**
     * The height sync requested and will commit. Every row takes its block
     * number from here rather than from the response header, because java-tron
     * omits a header field at its default and a gap or progress row naming the
     * wrong height points an operator at a block that was never missing.
     */
    blockNumber: number;
    /** The block exactly as `getblockbynum` returned it. */
    block: TronGridBlock;
    /** The block's receipts as `gettransactioninfobyblocknum` returned them; empty when none were fetched. */
    receipts: readonly TronGridTransactionInfo[];
    /** The block's time, after sync's normalization of the timestamp quirk. */
    blockTime: Date;
    /** Whether every transaction in the block got a receipt. */
    receiptsFetched: boolean;
}

/** The row fields every per-transaction table shares. */
export interface ITransactionContext {
    block_number: number;
    block_timestamp: string;
    transaction_index: number;
}

/** A contract type's columns, read off its parameter value. */
type ContractColumnReader = (value: Record<string, unknown>) => ChainDataRow;

/** The range of a ClickHouse `Int64` column, which is also java-tron's int64. */
const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

/** The range a JavaScript number holds integers exactly in. */
const SAFE_MIN = BigInt(Number.MIN_SAFE_INTEGER);
const SAFE_MAX = BigInt(Number.MAX_SAFE_INTEGER);

/** Matches a whole decimal integer, as the exact-integer parser writes one. */
const INTEGER_TEXT = /^-?\d+$/;

/**
 * Read a number the protobuf types as an integer, without losing precision.
 *
 * java-tron omits a field at its default of zero, and the block endpoints
 * deliver an int64 beyond 2^53 as its exact decimal string (see
 * `parseJsonExactIntegers`), so an absent field, a number, and a string are all
 * handled here rather than at every call site. A value beyond 2^53 is returned
 * as that string, because ClickHouse reads a quoted integer into an `Int64`
 * exactly, while a JavaScript number would already be rounded.
 *
 * A value outside the `Int64` range is treated as unreadable. java-tron cannot
 * produce one, and ClickHouse would not reject it: it wraps the value into a
 * different number, often a negative one, without raising an error.
 *
 * @param value - The raw JSON value.
 * @returns The integer as a number when it fits one exactly, as a decimal
 *          string when it does not, or 0 when the field was absent or unreadable.
 */
function toInt(value: unknown): number | string {
    let result: number | string = 0;
    if (typeof value === 'number' && Number.isSafeInteger(Math.trunc(value))) {
        // The common case, kept free of BigInt work since it runs for every column of every row.
        result = Math.trunc(value);
    } else {
        let exact: bigint | null = null;
        if (typeof value === 'number' && Number.isFinite(value)) {
            exact = BigInt(Math.trunc(value));
        } else if (typeof value === 'string' && INTEGER_TEXT.test(value.trim())) {
            exact = BigInt(value.trim());
        } else if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
            exact = BigInt(Math.trunc(Number(value)));
        }
        if (exact !== null && exact >= INT64_MIN && exact <= INT64_MAX) {
            result = exact >= SAFE_MIN && exact <= SAFE_MAX ? Number(exact) : exact.toString(10);
        }
    }
    return result;
}

/**
 * Read a string field, defaulting to empty as the protobuf does.
 *
 * @param value - The raw JSON value.
 * @returns The string, or `''` when the field was absent or not a string.
 */
function toText(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

/**
 * Read a boolean field, defaulting to false as the protobuf does.
 *
 * @param value - The raw JSON value.
 * @returns True only when the field was literally true.
 */
function toFlag(value: unknown): boolean {
    return value === true;
}

/**
 * Convert an address from java-tron's hex form to base58.
 *
 * Accepts the 21-byte `41…` form addresses take in most messages and the 20-byte
 * form log addresses take. A value that does not convert is kept as it arrived,
 * because an unreadable address is still evidence and an empty one is not.
 *
 * @param value - The raw JSON value.
 * @returns The base58 address, the original text when it did not convert, or `''` when absent.
 */
function toAddress(value: unknown): string {
    let result = '';
    if (typeof value === 'string' && value.length > 0) {
        try {
            result = toBase58Address(value);
        } catch {
            result = value;
        }
    }
    return result;
}

/**
 * Serialize a nested message as canonical JSON, the form the schema keeps
 * nested messages in when they have no table of their own.
 *
 * @param value - The nested message, or undefined when java-tron omitted it.
 * @returns The JSON text, or `''` when the message was absent.
 */
function toJson(value: unknown): string {
    return value === undefined || value === null ? '' : JSON.stringify(value);
}

/**
 * The earliest and latest instants a `DateTime64(3)` column accepts, in epoch
 * milliseconds. A transaction's `raw_data.timestamp` is chosen by whoever signed
 * it and java-tron does not check it, so a value outside this range can reach
 * the chain. Written as-is it either fails to parse (a five-digit year) or lands
 * out of range, and the failing insert takes every block in its batch with it.
 */
const MIN_DATETIME64_MS = Date.UTC(1900, 0, 1);
const MAX_DATETIME64_MS = Date.UTC(2299, 11, 31, 23, 59, 59, 999);

/**
 * Render an epoch-milliseconds value as ClickHouse's datetime form, or report
 * that it cannot be stored.
 *
 * Exists so a signer-chosen time that ClickHouse would reject is caught while
 * the row is built, rather than failing the whole batch's insert.
 *
 * @param milliseconds - The raw JSON value in epoch milliseconds.
 * @returns The formatted instant, or null when the value falls outside what a
 *          `DateTime64(3)` column can hold.
 */
function readDateTime(milliseconds: unknown): string | null {
    // A time beyond 2^53 ms comes back from toInt as text; as a number it is
    // simply far out of range, which is all this check needs to know.
    const value = Number(toInt(milliseconds));
    return value >= MIN_DATETIME64_MS && value <= MAX_DATETIME64_MS
        ? formatClickHouseDateTime64Utc(new Date(value))
        : null;
}

/**
 * Render an epoch-milliseconds value as ClickHouse's datetime form, for a
 * column that cannot be null.
 *
 * @param milliseconds - The raw JSON value in epoch milliseconds.
 * @returns The formatted instant, or the epoch when the value is unusable, since
 *          the column cannot be empty and an obviously-wrong time is easier to
 *          spot than a plausible invented one.
 */
function toDateTime(milliseconds: unknown): string {
    return readDateTime(milliseconds) ?? formatClickHouseDateTime64Utc(new Date(0));
}

/**
 * Each typed contract table's columns, read from the contract's parameter value.
 *
 * Keyed by java-tron's contract type. Every type listed in
 * `CONTRACT_TABLE_SPECS` must appear here, and the names written must match the
 * columns declared there, which the mapper's tests check.
 */
const CONTRACT_COLUMN_READERS: Readonly<Record<string, ContractColumnReader>> = {
    TransferContract: value => ({
        owner_address: toAddress(value.owner_address),
        to_address: toAddress(value.to_address),
        amount: toInt(value.amount)
    }),
    TransferAssetContract: value => ({
        asset_name: toText(value.asset_name),
        owner_address: toAddress(value.owner_address),
        to_address: toAddress(value.to_address),
        amount: toInt(value.amount)
    }),
    TriggerSmartContract: value => ({
        owner_address: toAddress(value.owner_address),
        contract_address: toAddress(value.contract_address),
        call_value: toInt(value.call_value),
        data: toText(value.data),
        call_token_value: toInt(value.call_token_value),
        token_id: toInt(value.token_id)
    }),
    DelegateResourceContract: value => ({
        owner_address: toAddress(value.owner_address),
        resource: toText(value.resource) || 'BANDWIDTH',
        balance: toInt(value.balance),
        receiver_address: toAddress(value.receiver_address),
        lock: toFlag(value.lock),
        lock_period: toInt(value.lock_period)
    }),
    UnDelegateResourceContract: value => ({
        owner_address: toAddress(value.owner_address),
        resource: toText(value.resource) || 'BANDWIDTH',
        balance: toInt(value.balance),
        receiver_address: toAddress(value.receiver_address)
    }),
    FreezeBalanceV2Contract: value => ({
        owner_address: toAddress(value.owner_address),
        frozen_balance: toInt(value.frozen_balance),
        resource: toText(value.resource) || 'BANDWIDTH'
    }),
    UnfreezeBalanceV2Contract: value => ({
        owner_address: toAddress(value.owner_address),
        unfreeze_balance: toInt(value.unfreeze_balance),
        resource: toText(value.resource) || 'BANDWIDTH'
    }),
    WithdrawExpireUnfreezeContract: value => ({
        owner_address: toAddress(value.owner_address)
    }),
    AccountCreateContract: value => ({
        owner_address: toAddress(value.owner_address),
        account_address: toAddress(value.account_address),
        type: toText(value.type) || 'Normal'
    }),
    AccountPermissionUpdateContract: value => ({
        owner_address: toAddress(value.owner_address),
        owner: toJson(value.owner),
        witness: toJson(value.witness),
        actives: Array.isArray(value.actives) ? value.actives.map(active => JSON.stringify(active)) : []
    }),
    VoteWitnessContract: value => {
        const votes = Array.isArray(value.votes) ? (value.votes as Array<Record<string, unknown>>) : [];
        return {
            owner_address: toAddress(value.owner_address),
            'votes.vote_address': votes.map(vote => toAddress(vote.vote_address)),
            'votes.vote_count': votes.map(vote => toInt(vote.vote_count)),
            support: toFlag(value.support)
        };
    }
};

/**
 * The java-tron contract types that have a typed table, for the mapper's own
 * consistency check against the schema.
 *
 * @returns Every contract type a column reader exists for.
 */
export function listMappedContractTypes(): string[] {
    return Object.keys(CONTRACT_COLUMN_READERS);
}

/**
 * Build the `tron.block` row.
 *
 * @param block - The block as fetched.
 * @param blockNumber - The height sync requested, so this row agrees with the
 *                      block number every other table records for the block.
 * @param blockTimestamp - The block time, already formatted.
 * @param receiptsFetched - Whether receipt rows exist for this block.
 * @returns The row.
 */
function blockRow(block: TronGridBlock, blockNumber: number, blockTimestamp: string, receiptsFetched: boolean): ChainDataRow {
    const raw = block.block_header.raw_data;
    return {
        block_number: blockNumber,
        block_id: toText(block.blockID),
        timestamp: blockTimestamp,
        parent_hash: toText(raw.parentHash),
        tx_trie_root: toText(raw.txTrieRoot ?? raw.transactions_root),
        witness_address: toAddress(raw.witness_address),
        witness_id: toInt(raw.witness_id),
        version: toInt(raw.version),
        account_state_root: toText(raw.accountStateRoot ?? raw.account_state_root),
        witness_signature: toText(block.block_header.witness_signature),
        transaction_count: block.transactions?.length ?? 0,
        _receipts_fetched: receiptsFetched
    };
}

/**
 * Build a `tron.transaction` row.
 *
 * @param transaction - The transaction as fetched.
 * @param context - The block number, time, and position shared by every row about it.
 * @returns The row.
 */
function transactionRow(transaction: TronGridTransaction, context: ITransactionContext): ChainDataRow {
    const raw = transaction.raw_data;
    const contract = raw.contract?.[0];
    const ret = transaction.ret?.[0];
    return {
        ...context,
        tx_id: toText(transaction.txID),
        ref_block_bytes: toText(raw.ref_block_bytes),
        ref_block_num: toInt(raw.ref_block_num),
        ref_block_hash: toText(raw.ref_block_hash),
        expiration: toDateTime(raw.expiration),
        timestamp: raw.timestamp ? readDateTime(raw.timestamp) : null,
        fee_limit: toInt(raw.fee_limit),
        data: toText(raw.data),
        contract_type: toText(contract?.type),
        permission_id: toInt(contract?.Permission_id),
        parameter: toJson(contract?.parameter?.value ?? {}),
        contract_count: raw.contract?.length ?? 0,
        signature: Array.isArray(transaction.signature) ? transaction.signature : [],
        contract_ret: toText(ret?.contractRet) || 'DEFAULT',
        fee: toInt(ret?.fee),
        raw_data_hex: toText(transaction.raw_data_hex)
    };
}

/**
 * Build a transaction's typed contract row, when its contract type has a table.
 *
 * @param transaction - The transaction as fetched.
 * @param context - The block number, time, and position shared by every row about it.
 * @returns The table name and row, or null for a contract type with no table.
 */
function contractRow(
    transaction: TronGridTransaction,
    context: ITransactionContext
): { table: string; row: ChainDataRow } | null {
    const contract = transaction.raw_data.contract?.[0];
    const reader = contract ? CONTRACT_COLUMN_READERS[contract.type] : undefined;
    let result: { table: string; row: ChainDataRow } | null = null;
    if (contract && reader) {
        result = {
            table: contractTableName(contract.type),
            row: {
                ...context,
                tx_id: toText(transaction.txID),
                contract_ret: toText(transaction.ret?.[0]?.contractRet) || 'DEFAULT',
                permission_id: toInt(contract.Permission_id),
                ...reader(contract.parameter?.value ?? {})
            }
        };
    }
    return result;
}

/**
 * Turn java-tron's `{ key, value }` rendering of a protobuf map into the object
 * a ClickHouse `Map` column expects.
 *
 * @param pairs - The map as java-tron's JSON renders it.
 * @returns The same entries as a plain object, each value as {@link toInt} reads it.
 */
function toMap(pairs: unknown): Record<string, number | string> {
    const result: Record<string, number | string> = {};
    if (Array.isArray(pairs)) {
        for (const pair of pairs as Array<Record<string, unknown>>) {
            if (typeof pair?.key === 'string') {
                result[pair.key] = toInt(pair.value);
            }
        }
    }
    return result;
}

/**
 * Build a `tron.transaction_info` row.
 *
 * `result` defaults to `SUCESS` — java-tron's own spelling — because java-tron
 * writes the field only when a transaction failed. `receipt_result` defaults to
 * `DEFAULT`, the zero value of its enumeration.
 *
 * @param info - The receipt as fetched.
 * @param context - The block number, time, and position of the transaction it belongs to.
 * @returns The row.
 */
function transactionInfoRow(info: TronGridTransactionInfo, context: ITransactionContext): ChainDataRow {
    const receipt = info.receipt ?? {};
    return {
        ...context,
        tx_id: toText(info.id),
        fee: toInt(info.fee),
        result: toText(info.result) || 'SUCESS',
        res_message: toText(info.resMessage),
        contract_address: toAddress(info.contract_address),
        contract_result: Array.isArray(info.contractResult) ? info.contractResult.map(toText) : [],
        receipt_energy_usage: toInt(receipt.energy_usage),
        receipt_energy_fee: toInt(receipt.energy_fee),
        receipt_origin_energy_usage: toInt(receipt.origin_energy_usage),
        receipt_energy_usage_total: toInt(receipt.energy_usage_total),
        receipt_net_usage: toInt(receipt.net_usage),
        receipt_net_fee: toInt(receipt.net_fee),
        receipt_result: toText(receipt.result) || 'DEFAULT',
        receipt_energy_penalty_total: toInt(receipt.energy_penalty_total),
        asset_issue_id: toText(info.assetIssueID),
        withdraw_amount: toInt(info.withdraw_amount),
        unfreeze_amount: toInt(info.unfreeze_amount),
        withdraw_expire_amount: toInt(info.withdraw_expire_amount),
        packing_fee: toInt(info.packingFee),
        cancel_unfreeze_v2_amount: toMap(info.cancel_unfreezeV2_amount),
        exchange_received_amount: toInt(info.exchange_received_amount),
        exchange_inject_another_amount: toInt(info.exchange_inject_another_amount),
        exchange_withdraw_another_amount: toInt(info.exchange_withdraw_another_amount),
        exchange_id: toInt(info.exchange_id),
        shielded_transaction_fee: toInt(info.shielded_transaction_fee),
        order_id: toText(info.orderId),
        order_details: toJson(info.orderDetails)
    };
}

/**
 * Build the `tron.log` rows for one receipt.
 *
 * `_topic0` copies the first topic — the event signature for a standard event —
 * into its own column so it can lead the sort key, which is what makes "every
 * `Transfer` from this contract" a range read.
 *
 * @param info - The receipt as fetched.
 * @param context - The block number, time, and position of the transaction it belongs to.
 * @returns One row per log entry, in the order java-tron reported them.
 */
function logRows(info: TronGridTransactionInfo, context: ITransactionContext): ChainDataRow[] {
    return (info.log ?? []).map((log, logIndex) => {
        const topics = Array.isArray(log.topics) ? log.topics.map(toText) : [];
        return {
            ...context,
            tx_id: toText(info.id),
            log_index: logIndex,
            address: toAddress(log.address),
            topics,
            data: toText(log.data),
            _topic0: topics[0] ?? ''
        };
    });
}

/**
 * Build the `tron.internal_transaction` rows for one receipt.
 *
 * @param info - The receipt as fetched.
 * @param context - The block number, time, and position of the transaction it belongs to.
 * @returns One row per internal transaction, in the order java-tron reported them.
 */
function internalTransactionRows(info: TronGridTransactionInfo, context: ITransactionContext): ChainDataRow[] {
    return (info.internal_transactions ?? []).map((internal, internalIndex) => {
        const callValues = Array.isArray(internal.callValueInfo)
            ? (internal.callValueInfo as Array<Record<string, unknown>>)
            : [];
        return {
            ...context,
            tx_id: toText(info.id),
            internal_index: internalIndex,
            hash: toText(internal.hash),
            caller_address: toAddress(internal.caller_address),
            transfer_to_address: toAddress(internal.transferTo_address),
            'call_value_info.call_value': callValues.map(entry => toInt(entry.callValue)),
            'call_value_info.token_id': callValues.map(entry => toText(entry.tokenId)),
            note: toText(internal.note),
            rejected: toFlag(internal.rejected),
            extra: toText(internal.extra)
        };
    });
}

/**
 * Build every row one block contributes to the `tron` tables.
 *
 * Receipts are joined to their transactions by id, and each receipt row takes
 * the position of its transaction in the block, so every table orders the same
 * way. A receipt whose transaction is not in the block has no position to take
 * and is left out rather than given a false one.
 *
 * Each transaction's value movements also become `tron._transfer` rows, built
 * by {@link buildTransferRows} from the transaction and its receipt.
 *
 * @param input - The requested height, the block, its receipts, its normalized
 *                time, and the receipt flag.
 * @returns The rows, keyed by table name.
 */
export function buildChainDataRows(input: IChainDataRowsInput): IChainDataRows {
    const { blockNumber, block, receipts, blockTime, receiptsFetched } = input;
    const blockTimestamp = formatClickHouseDateTime64Utc(blockTime);
    const transactions = block.transactions ?? [];

    const tables: Record<string, ChainDataRow[]> = {
        block: [blockRow(block, blockNumber, blockTimestamp, receiptsFetched)],
        transaction: [],
        transaction_info: [],
        log: [],
        internal_transaction: []
    };
    for (const spec of CONTRACT_TABLE_SPECS) {
        tables[contractTableName(spec.contractType)] = [];
    }

    tables[TRANSFER_TABLE] = [];

    const receiptsById = new Map<string, TronGridTransactionInfo>();
    for (const info of receipts) {
        receiptsById.set(info.id, info);
    }

    const positions = new Map<string, number>();
    transactions.forEach((transaction, transactionIndex) => {
        positions.set(transaction.txID, transactionIndex);
        const context: ITransactionContext = { block_number: blockNumber, block_timestamp: blockTimestamp, transaction_index: transactionIndex };
        tables.transaction.push(transactionRow(transaction, context));
        const typed = contractRow(transaction, context);
        if (typed) {
            tables[typed.table].push(typed.row);
        }
        tables[TRANSFER_TABLE].push(...buildTransferRows({ transaction, context, receipt: receiptsById.get(transaction.txID) }));
    });

    for (const info of receipts) {
        const transactionIndex = positions.get(info.id);
        if (transactionIndex !== undefined) {
            const context: ITransactionContext = { block_number: blockNumber, block_timestamp: blockTimestamp, transaction_index: transactionIndex };
            tables.transaction_info.push(transactionInfoRow(info, context));
            tables.log.push(...logRows(info, context));
            tables.internal_transaction.push(...internalTransactionRows(info, context));
        }
    }

    return { blockNumber, blockTimestamp, tables };
}
