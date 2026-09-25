/**
 * @fileoverview Turning one transaction's value movements into `tron._transfer` rows.
 *
 * `tron._transfer` is a ledger of TRX, TRC-10, and TRC-20 value moving between
 * two accounts, written twice: once from the sender's side and once from the
 * receiver's. The contract types it reads are listed on `contractMovements`,
 * along with the one movement it cannot record: the TRC-10 tokens a buyer
 * receives from a token sale. The java-tron tables cannot answer "what did this
 * wallet receive" cheaply, because they sort by sender, and a TRC-20 transfer's
 * parties are buried in `tron.log` topics. Writing a row for each party, sorted
 * by that party's address, makes both directions a range read.
 *
 * A row is written only for value that actually moved:
 * - A top-level TRX or TRC-10 movement counts only when the transaction's
 *   `contractRet` is `SUCCESS`; a reverted call moved nothing.
 * - TRC-20 movements come from the receipt's `Transfer` logs, which java-tron
 *   keeps only for executions that succeeded. A zero-amount log is kept,
 *   because a zero-value transfer is how address poisoning shows up.
 * - Internal transfers come from the receipt, and a rejected one is left out.
 *
 * TRC-20 and internal rows come only from receipts, never from call data. A
 * transaction without a receipt contributes none, so a block whose receipts
 * were not fetched has none at all, and a block whose receipts arrived for only
 * some transactions has them for those transactions alone. Decoding call data
 * instead would make a block written once without receipts and again with them
 * hold the same transfer twice under two sources. `tron.block._receipts_fetched`
 * tells a reader which blocks are complete.
 *
 * Decoding reuses the same functions block sync uses for observers, so the
 * ledger and the observer payloads cannot disagree about what a log means.
 *
 * @module backend/modules/blockchain/chain-data/buildTransferRows
 */

import { TronGridClient, type TronGridTransaction, type TronGridTransactionInfo } from '../tron-grid.client.js';
import { decodeTransferEvent, normalizeContractEvents } from '../contract-events.js';
import { decodeInternalTransfers, toPositiveAmount } from '../internal-transfers.js';
import type { ChainDataRow, ITransactionContext } from './buildChainDataRows.js';

/** Where a movement was read from, stored in the `source` column. */
export type TransferSource = 'contract' | 'log' | 'internal';

/** Which kind of asset moved, stored in the `asset_type` column. */
export type TransferAssetType = 'trx' | 'trc10' | 'trc20';

/** One movement of value from one account to another, before it is split into two rows. */
interface IValueMovement {
    /** Where the movement was read from. */
    source: TransferSource;
    /**
     * The movement's position within its source: 0 for the transaction's own
     * contract, the log index for a log, the internal index for an internal
     * transfer. Together with `source` and `token` it identifies the movement
     * within its transaction.
     */
    eventIndex: number;
    /** Base58 address the value left. */
    from: string;
    /** Base58 address the value reached. */
    to: string;
    /** Which kind of asset moved. */
    assetType: TransferAssetType;
    /** Empty for TRX, the numeric id for TRC-10, the contract address for TRC-20. */
    token: string;
    /** The amount in the asset's smallest unit, as a decimal string. */
    amount: string;
}

/** What {@link buildTransferRows} needs to know about one transaction. */
export interface ITransferRowsInput {
    /** The transaction exactly as `getblockbynum` returned it. */
    transaction: TronGridTransaction;
    /** The block number, time, and position every row about this transaction carries. */
    context: ITransactionContext;
    /** The transaction's receipt, or undefined when none was fetched. */
    receipt: TronGridTransactionInfo | undefined;
}

/** Matches hex text of whole bytes, the form java-tron gives `asset_name` in. */
const HEX_BYTES = /^([0-9a-fA-F]{2})+$/;

/** Matches a TRC-10 token id, which is a decimal number. */
const TOKEN_ID = /^\d+$/;

/**
 * Convert an address from java-tron's hex form to base58.
 *
 * A movement whose party cannot be read is left out of the ledger rather than
 * stored under a raw value, because every query against this table starts
 * from a base58 address and could never find it.
 *
 * @param value - The raw JSON value.
 * @returns The base58 address, or null when the value is not a readable address.
 */
function readAddress(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? TronGridClient.toBase58Address(value) : null;
}

/**
 * Read a TRC-10 token id from a `TransferAssetContract`'s `asset_name`.
 *
 * Since `ALLOW_SAME_TOKEN_NAME`, `asset_name` holds the token's numeric id, but
 * java-tron renders it as hex bytes (`31303030303031` for `1000001`). Internal
 * transfers name the same token as plain text, so the ledger stores the plain
 * id, which lets one `token` value match both sources.
 *
 * @param value - The raw `asset_name`.
 * @returns The decimal token id, or the text as it arrived when it does not
 *          decode to one.
 */
function readAssetId(value: unknown): string {
    let tokenId = typeof value === 'string' ? value : '';
    if (HEX_BYTES.test(tokenId)) {
        const decoded = Buffer.from(tokenId, 'hex').toString('utf8');
        if (TOKEN_ID.test(decoded)) {
            tokenId = decoded;
        }
    }
    return tokenId;
}

/**
 * Read the TRX and TRC-10 token a contract call or deployment carried into a contract.
 *
 * `TriggerSmartContract` and `CreateSmartContract` can each attach TRX and one
 * TRC-10 token, and both name the token in `call_token_value` and `token_id`.
 * Only the TRX amount sits in a different field for each, so the caller passes
 * it in and this one function builds the movements for both types.
 *
 * @param from - The account that signed the call and paid the value.
 * @param to - The contract that received the value.
 * @param callValue - The raw TRX amount, read from wherever the contract type keeps it.
 * @param value - The contract's parameter value, which holds the TRC-10 fields.
 * @returns Up to two movements: one for TRX and one for the TRC-10 token.
 */
function callValueMovements(from: string, to: string, callValue: unknown, value: Record<string, unknown>): IValueMovement[] {
    const movements: IValueMovement[] = [];
    const trxAmount = toPositiveAmount(callValue);
    const tokenAmount = toPositiveAmount(value.call_token_value);
    if (trxAmount) {
        movements.push({ source: 'contract', eventIndex: 0, from, to, assetType: 'trx', token: '', amount: trxAmount });
    }
    if (tokenAmount) {
        movements.push({ source: 'contract', eventIndex: 0, from, to, assetType: 'trc10', token: String(value.token_id ?? ''), amount: tokenAmount });
    }
    return movements;
}

/**
 * Read the movements a transaction's own contract made.
 *
 * Five contract types hand value from one account to another:
 * - `TransferContract` moves TRX.
 * - `TransferAssetContract` moves a TRC-10 token.
 * - `TriggerSmartContract` can carry TRX and a TRC-10 token into the contract it calls.
 * - `CreateSmartContract` can carry TRX and a TRC-10 token into the contract it
 *   deploys. The new contract's address is read from the transaction's own
 *   `contract_address`, which the block response includes, so no receipt is needed.
 * - `ParticipateAssetIssueContract` buys a TRC-10 token during its issue: the
 *   buyer pays TRX to the issuer. Only that TRX half is recorded. The tokens the
 *   buyer receives depend on the ratio set when the token was issued, which the
 *   block does not contain.
 *
 * Staking, delegation, and rewards change what an account holds without
 * handing value to another account, so they stay in their own tables.
 *
 * @param transaction - The transaction as fetched.
 * @returns The movements, empty when the transaction did not succeed or moved no value.
 */
function contractMovements(transaction: TronGridTransaction): IValueMovement[] {
    const movements: IValueMovement[] = [];
    const contract = transaction.raw_data.contract?.[0];
    const value = (contract?.parameter?.value ?? {}) as Record<string, unknown>;
    const succeeded = transaction.ret?.[0]?.contractRet === 'SUCCESS';
    const from = readAddress(value.owner_address);

    if (contract && succeeded && from) {
        if (contract.type === 'TransferContract' || contract.type === 'ParticipateAssetIssueContract') {
            const to = readAddress(value.to_address);
            const amount = toPositiveAmount(value.amount);
            if (to && amount) {
                movements.push({ source: 'contract', eventIndex: 0, from, to, assetType: 'trx', token: '', amount });
            }
        } else if (contract.type === 'TransferAssetContract') {
            const to = readAddress(value.to_address);
            const amount = toPositiveAmount(value.amount);
            if (to && amount) {
                movements.push({ source: 'contract', eventIndex: 0, from, to, assetType: 'trc10', token: readAssetId(value.asset_name), amount });
            }
        } else if (contract.type === 'TriggerSmartContract') {
            const to = readAddress(value.contract_address);
            if (to) {
                movements.push(...callValueMovements(from, to, value.call_value, value));
            }
        } else if (contract.type === 'CreateSmartContract') {
            const to = readAddress(transaction.contract_address);
            const newContract = (value.new_contract ?? {}) as Record<string, unknown>;
            if (to) {
                movements.push(...callValueMovements(from, to, newContract.call_value, value));
            }
        }
    }

    return movements;
}

/**
 * Read the TRC-20 movements in a receipt's `Transfer` logs.
 *
 * TRC-721 transfers share the event signature but move a token id rather than
 * an amount, so they are left out; the ledger records quantities.
 *
 * @param txId - The transaction the receipt belongs to.
 * @param receipt - The receipt as fetched.
 * @returns One movement per TRC-20 `Transfer` log, in log order.
 */
function logMovements(txId: string, receipt: TronGridTransactionInfo): IValueMovement[] {
    const movements: IValueMovement[] = [];
    for (const event of normalizeContractEvents(txId, receipt.log)) {
        const transfer = decodeTransferEvent(event);
        if (transfer?.standard === 'trc20' && transfer.rawAmount !== undefined) {
            movements.push({
                source: 'log',
                eventIndex: event.logIndex,
                from: transfer.from,
                to: transfer.to,
                assetType: 'trc20',
                token: transfer.contractAddress,
                amount: transfer.rawAmount
            });
        }
    }
    return movements;
}

/**
 * Read the TRX and TRC-10 movements in a receipt's internal transactions.
 *
 * One internal transaction can carry several value entries. Two entries for
 * the same token under the same internal index would share a sort key and
 * collapse into one row when ClickHouse merges parts, so their amounts are
 * added together first.
 *
 * @param txId - The transaction the receipt belongs to.
 * @param receipt - The receipt as fetched.
 * @returns One movement per internal index and token, leaving out rejected transfers.
 */
function internalMovements(txId: string, receipt: TronGridTransactionInfo): IValueMovement[] {
    const byIdentity = new Map<string, IValueMovement>();
    for (const transfer of decodeInternalTransfers(txId, receipt.internal_transactions)) {
        if (!transfer.rejected) {
            const token = transfer.tokenId ?? '';
            const identity = `${transfer.internalIndex}:${token}`;
            const existing = byIdentity.get(identity);
            if (existing) {
                existing.amount = (BigInt(existing.amount) + BigInt(transfer.rawAmount)).toString(10);
            } else {
                byIdentity.set(identity, {
                    source: 'internal',
                    eventIndex: transfer.internalIndex,
                    from: transfer.from,
                    to: transfer.to,
                    assetType: token ? 'trc10' : 'trx',
                    token,
                    amount: transfer.rawAmount
                });
            }
        }
    }
    return [...byIdentity.values()];
}

/**
 * Build the `tron._transfer` rows for one transaction.
 *
 * Each movement becomes two rows. The sender's row has `direction = 'out'`
 * and names the receiver as its counterparty; the receiver's row has
 * `direction = 'in'` and names the sender.
 *
 * @param input - The transaction, its row context, and its receipt when one was fetched.
 * @returns The rows, empty when the transaction moved no value.
 */
export function buildTransferRows(input: ITransferRowsInput): ChainDataRow[] {
    const { transaction, context, receipt } = input;
    const txId = transaction.txID;
    const movements = contractMovements(transaction);
    if (receipt) {
        movements.push(...logMovements(txId, receipt), ...internalMovements(txId, receipt));
    }

    const rows: ChainDataRow[] = [];
    for (const movement of movements) {
        const shared = {
            ...context,
            tx_id: txId,
            source: movement.source,
            event_index: movement.eventIndex,
            asset_type: movement.assetType,
            token: movement.token,
            amount: movement.amount
        };
        rows.push(
            { ...shared, address: movement.from, direction: 'out', counterparty: movement.to },
            { ...shared, address: movement.to, direction: 'in', counterparty: movement.from }
        );
    }
    return rows;
}
