/**
 * One event log a contract emitted while a transaction ran, normalised but not
 * decoded.
 *
 * Event logs are the record explorers and analytics firms read, because a
 * contract emits them for every token movement it performs, including the ones
 * that happen inside another contract's call (a DEX swap, a bridge, a batch
 * payout). The call data a signer sent only describes the outermost call, so
 * logs are the only complete source. They exist only in the transaction
 * receipt, which block sync fetches when an operator has switched
 * `fetchBlockReceipts` on.
 *
 * Core applies no ABI knowledge here. The topics and data stay as the chain
 * returned them, apart from lowercasing and removing any `0x`, so a plugin can
 * decode a contract-specific event (USDT `Issue`, a SunSwap `Swap`) itself.
 * Core fully decodes only standards every consumer reads the same way; see
 * `ITokenTransferEvent`.
 */
export interface IContractEvent {
    /**
     * Stable identity of this event, `${txId}:${logIndex}`.
     *
     * One transaction can emit many events, including several `Transfer`
     * events for one token, so a transaction id alone is not unique. Use this
     * value as the unique key when storing anything derived from an event.
     */
    eventId: string;

    /** Transaction that emitted the event. */
    txId: string;

    /**
     * Zero-based position of the event in its transaction's log list, which is
     * the order the chain emitted them in.
     */
    logIndex: number;

    /**
     * Base58 address of the contract that emitted the event.
     *
     * For a token `Transfer` this is the token contract, even when the
     * transaction's signer called some other contract that moved the tokens.
     */
    contractAddress: string;

    /**
     * Indexed topics as 64-character lowercase hex strings without `0x`.
     *
     * `topics[0]` is the keccak-256 hash of the event signature and identifies
     * the event, for example `ddf252ad…` for `Transfer(address,address,uint256)`.
     * The remaining entries are the event's indexed arguments.
     */
    topics: string[];

    /**
     * Non-indexed arguments, ABI-encoded, as lowercase hex without `0x`.
     * Empty when the event has no non-indexed arguments.
     */
    data: string;
}
