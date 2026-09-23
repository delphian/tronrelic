/**
 * A token movement decoded from a standard `Transfer` event, or from call data
 * when no receipt was available.
 *
 * Core decodes this one event itself, instead of leaving it to each plugin,
 * because every consumer reads it the same way and two details are easy to get
 * wrong: TRC20 and TRC721 share the `Transfer(address,address,uint256)`
 * signature and differ only in how many topics they carry, and a transaction id
 * is not a unique key for a transfer.
 *
 * Each transaction's `tokenTransfers` list is filled from exactly one source,
 * never both, so there are no duplicates to merge:
 *
 * - `'log'` when the block's receipts were fetched in full. Every `Transfer`
 *   event is listed, including the ones emitted inside another contract's call
 *   (swaps, bridges, batch payouts). A reverted transaction emits no logs, so
 *   an entry here means the tokens moved.
 * - `'calldata'` when they were not. Only a direct `transfer` or
 *   `transferFrom` call on the token is visible, and only when the
 *   transaction's status is `SUCCESS`. A non-standard token that returns
 *   `false` instead of reverting still looks successful, so treat these
 *   entries as requested rather than proven.
 *
 * A consumer that needs complete data filters on `source === 'log'`.
 */
export interface ITokenTransferEvent {
    /**
     * Stable identity of the transfer. `${txId}:${logIndex}` for a log-sourced
     * transfer, which matches the `eventId` of the `IContractEvent` it was
     * decoded from, and `${txId}:calldata` for a call-data transfer. Use it as
     * the unique key when storing transfers.
     */
    eventId: string;

    /** Transaction the transfer belongs to. */
    txId: string;

    /**
     * Position of the source event in the transaction's log list. Absent for a
     * call-data transfer, which has no log.
     */
    logIndex?: number;

    /** Where the transfer was read from. See the interface description. */
    source: 'log' | 'calldata';

    /**
     * Which token standard emitted the event. A TRC20 `Transfer` has three
     * topics and carries the amount in `data`; a TRC721 `Transfer` has four
     * topics and carries the token id as the last topic. Call-data transfers
     * are always `'trc20'`.
     */
    standard: 'trc20' | 'trc721';

    /** Base58 address of the token contract. */
    contractAddress: string;

    /** Base58 address the token left. The zero address marks a mint. */
    from: string;

    /** Base58 address the token went to. The zero address marks a burn. */
    to: string;

    /**
     * TRC20 amount in the token's smallest units, as a decimal string, because
     * a uint256 routinely exceeds what a JavaScript number holds exactly.
     * Divide by `10 ** decimals` for display. Absent for TRC721.
     */
    rawAmount?: string;

    /** TRC721 token id as a decimal string. Absent for TRC20. */
    tokenId?: string;
}
