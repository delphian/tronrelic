/**
 * Which contract events an event observer wants delivered.
 *
 * Subscribing by event rather than by transaction type is what keeps a plugin
 * that watches USDT transfers from being handed every `TriggerSmartContract`
 * on the chain, the busiest transaction type there is, only to throw nearly all
 * of them away. Core indexes each block's events once and hands each observer
 * only the events matching its filters.
 *
 * An event matches when its `topics[0]` is one of `topic0` and, if
 * `contractAddresses` is given, it was emitted by one of those contracts.
 */
export interface IContractEventFilter {
    /**
     * Event signature hash or hashes to match against `topics[0]`, as hex with
     * or without `0x`, in any case. For example
     * `ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef` for
     * `Transfer(address,address,uint256)`.
     */
    topic0: string | string[];

    /**
     * Base58 addresses of the emitting contracts to accept. Omit it to accept
     * the event from any contract, which for `Transfer` means every token on
     * the chain.
     */
    contractAddresses?: string[];
}
