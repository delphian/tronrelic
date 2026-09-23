/**
 * TRX or a TRC10 token moved by a contract while a transaction ran, rather
 * than by the wallet that signed it.
 *
 * A contract that pays out TRX (a DEX returning TRX from a swap, a lending
 * protocol releasing collateral) does so through an internal transaction. The
 * transaction's own `to` and `amount` describe only the outer call, so these
 * movements are invisible without the receipt. Core decodes them from the
 * receipt's `internal_transactions` so each plugin does not have to read the
 * raw TronGrid shape.
 *
 * Only movements that carry value are listed. A contract calling another
 * contract with no value attached is not a transfer. The list is filled only
 * when the block's receipts were fetched in full; otherwise it is absent.
 */
export interface IInternalTransfer {
    /** Transaction that triggered the movement. */
    txId: string;

    /**
     * Zero-based position of the internal transaction in the receipt's
     * `internal_transactions` list. Together with `txId` it identifies the
     * internal transaction; one internal transaction can move TRX and a TRC10
     * token at once, which produces two entries with the same index.
     */
    internalIndex: number;

    /** Base58 address of the contract that sent the value. */
    from: string;

    /** Base58 address that received the value. */
    to: string;

    /**
     * Amount in the smallest unit, as a decimal string: SUN for TRX, or the
     * token's own smallest unit when `tokenId` is set.
     */
    rawAmount: string;

    /** TRC10 token id when a TRC10 token moved. Absent when TRX moved. */
    tokenId?: string;

    /**
     * The TVM operation that produced the movement, decoded from the receipt's
     * hex note, for example `'call'`, `'create'`, or `'suicide'`.
     */
    note: string;

    /**
     * True when the TVM rejected this internal transaction. A rejected entry
     * moved nothing, so most consumers skip it.
     */
    rejected: boolean;
}
