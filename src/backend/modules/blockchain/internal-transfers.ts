/**
 * @fileoverview Decodes the value a contract moved during a transaction.
 *
 * A contract that pays out TRX or a TRC10 token does it through an internal
 * transaction, which appears only in the receipt's `internal_transactions`,
 * with hex addresses, a hex note, and a list of value entries. This module
 * turns the entries that actually move value into `IInternalTransfer`s so
 * plugins do not each read the raw TronGrid shape.
 *
 * Not every internal transaction that carries a value is a transfer. When a
 * contract stakes, unstakes, or delegates through the TVM's Stake 2.0 opcodes,
 * java-tron records an internal transaction whose note names the operation,
 * such as `delegateResourceOfEnergy`, and whose value is the staked SUN that
 * changed state. No TRX changed hands. Only the notes in
 * {@link VALUE_TRANSFER_NOTES} are read as transfers, so both consumers of this
 * module, the observer payload and the ClickHouse `tron._transfer` ledger,
 * leave those staking entries out in the same way.
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
 * The decoded internal transaction notes whose value moved from one account to
 * another: `call` (a CALL or CALLTOKEN with value attached), `create` (a CREATE
 * or CREATE2 funding the new contract), and `suicide` (SELFDESTRUCT sending the
 * remaining balance to its beneficiary).
 *
 * This is an allow-list rather than a block-list, because java-tron names each
 * staking operation separately (`freezeBalanceV2ForEnergy`,
 * `unfreezeBalanceV2ForBandwidth`, `delegateResourceOfEnergy`,
 * `unDelegateResourceOfEnergy`, and others) and can add more. A staking note
 * missing from a block-list would be counted as TRX changing hands, which is
 * how a lending pool once appeared to send over a billion TRX.
 */
export const VALUE_TRANSFER_NOTES: ReadonlySet<string> = new Set(['call', 'create', 'suicide']);

/**
 * Decide whether an internal transaction's value moved between two accounts.
 *
 * The note is the only field that tells a transfer apart from a staking
 * operation, because both carry a `callValue`. This is exported so every reader
 * of internal transactions applies the same rule instead of keeping its own
 * copy of the note list.
 *
 * @param note - The note after decoding from hex, such as `call` or
 *               `delegateResourceOfEnergy`.
 * @returns True when the note is one of {@link VALUE_TRANSFER_NOTES}. False
 *          for a staking note and for a missing or unreadable note, since
 *          neither can be shown to have moved value.
 */
export function isValueTransferNote(note: string): boolean {
    return VALUE_TRANSFER_NOTES.has(note);
}

/**
 * Read a raw amount as a decimal string.
 *
 * Block sync parses receipts with exact integers, so a `callValue` beyond 2^53
 * arrives as its exact decimal string and is kept as-is. A smaller value
 * arrives as a number, and converting it through `BigInt` avoids the exponent
 * notation `String()` produces for very large numbers.
 *
 * Exported because the ClickHouse transfer ledger reads top-level contract
 * amounts the same way, and one reader keeps the two from disagreeing about
 * what counts as a movement.
 *
 * @param value - The raw amount, such as an internal `callValue` or a
 *                contract's `amount`, as the exact-integer parser delivered it.
 * @returns The amount as a decimal string, or null when it is not a positive
 *          number and so moved nothing.
 */
export function toPositiveAmount(value: unknown): string | null {
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
 * Internal transactions whose note is not a value transfer, such as the
 * staking notes described on {@link VALUE_TRANSFER_NOTES}, are skipped too,
 * because their value is staked SUN changing state rather than TRX moving to
 * another account. Rejected internal transactions are kept and flagged, so a
 * consumer that wants to count failed payouts can.
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
        const note = decodeNote(internal?.note);

        if (!from || !to || !isValueTransferNote(note)) {
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
                note,
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
