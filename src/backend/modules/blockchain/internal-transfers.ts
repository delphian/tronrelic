/**
 * @fileoverview Decodes the value a contract moved during a transaction.
 *
 * A contract that pays out TRX or a TRC10 token does it through an internal
 * transaction, which appears only in the receipt's `internal_transactions`,
 * with hex addresses, a hex note, and a list of value entries. This module
 * turns the entries that actually move value into `IInternalTransfer`s so
 * plugins do not each read the raw TronGrid shape.
 *
 * A pure module so a test pins the decoding without driving block sync.
 *
 * @module backend/modules/blockchain/internal-transfers
 */
import type { IInternalTransfer } from '@/types';
import { TronGridClient } from './tron-grid.client.js';

/** One value entry of a raw internal transaction. */
interface IRawCallValue {
    callValue?: unknown;
    tokenId?: unknown;
}

/**
 * Read a raw amount as a decimal string.
 *
 * TronGrid sends `callValue` as a JSON number. A value above 2^53 has already
 * lost precision in `JSON.parse`, and nothing here can recover it, but
 * converting through `BigInt` at least avoids the exponent notation
 * `String()` produces for very large numbers.
 *
 * @param value - The raw `callValue`.
 * @returns The amount as a decimal string, or null when it is not a positive
 *          number and so moved nothing.
 */
function toPositiveAmount(value: unknown): string | null {
    let amount: string | null = null;

    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        amount = BigInt(Math.trunc(value)).toString(10);
    } else if (typeof value === 'string' && /^\d+$/.test(value) && BigInt(value) > 0n) {
        amount = BigInt(value).toString(10);
    }

    return amount;
}

/**
 * Decode an internal transaction's hex note, such as `63616c6c` for `call`.
 *
 * @param note - The raw note.
 * @returns The decoded text, or an empty string when the note is missing or
 *          not hex.
 */
function decodeNote(note: unknown): string {
    let decoded = '';

    if (typeof note === 'string' && /^([0-9a-fA-F]{2})*$/.test(note)) {
        decoded = Buffer.from(note, 'hex').toString('utf8');
    }

    return decoded;
}

/**
 * Decode the value-bearing entries of a receipt's internal transactions.
 *
 * One internal transaction can carry several value entries, TRX and one or
 * more TRC10 tokens, and each becomes its own `IInternalTransfer` sharing the
 * internal transaction's index. Entries with no value are skipped, because a
 * contract calling another contract with nothing attached is not a transfer.
 * Rejected internal transactions are kept and flagged, so a consumer that
 * wants to count failed payouts can.
 *
 * @param txId - Transaction the internal transactions belong to.
 * @param internals - The receipt's `internal_transactions`, which may be absent.
 * @returns The decoded transfers in receipt order.
 */
export function decodeInternalTransfers(
    txId: string,
    internals: Array<Record<string, unknown>> | undefined
): IInternalTransfer[] {
    const transfers: IInternalTransfer[] = [];

    for (const [internalIndex, internal] of (internals ?? []).entries()) {
        const from = typeof internal?.caller_address === 'string'
            ? TronGridClient.toBase58Address(internal.caller_address)
            : null;
        const to = typeof internal?.transferTo_address === 'string'
            ? TronGridClient.toBase58Address(internal.transferTo_address)
            : null;
        const values = Array.isArray(internal?.callValueInfo) ? internal.callValueInfo as IRawCallValue[] : [];

        if (!from || !to) {
            continue;
        }

        for (const value of values) {
            const rawAmount = toPositiveAmount(value?.callValue);
            if (!rawAmount) {
                continue;
            }

            const transfer: IInternalTransfer = {
                txId,
                internalIndex,
                from,
                to,
                rawAmount,
                note: decodeNote(internal.note),
                rejected: internal.rejected === true
            };
            if (typeof value.tokenId === 'string' && value.tokenId.length > 0) {
                transfer.tokenId = value.tokenId;
            }

            transfers.push(transfer);
        }
    }

    return transfers;
}
