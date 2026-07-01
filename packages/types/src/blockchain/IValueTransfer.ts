/**
 * @fileoverview Source-independent domain record for a single on-chain VALUE
 * movement — one asset moving from one address to another inside a transaction.
 *
 * A transaction can move value more than once: a contract call performs several
 * internal (TVM) transfers, a vote spreads across witnesses, a payout fans out to
 * many recipients. `IBlockTransaction` models the *transaction*; this models each
 * discrete *value leg* of it, so a ledger can represent every movement without
 * collapsing legs that share a parent hash.
 *
 * Every field is an on-chain fact any block provider must satisfy — node RPC,
 * TronScan, or an archive alike — so it earns a place in the contract package.
 * The leg identity (`origin` + `legKey`) is deliberately protocol-grounded, never
 * a provider artifact: the internal-transaction hash a node computes in
 * `TransactionInfo` is the same value TronGrid surfaces as `internal_tx_id`, and a
 * log index is the same in any decoder. See `docs/system/system-domain-types.md`
 * for the admission rule; the account-history module README documents the
 * `account_value_transfers` ledger this type backs.
 */

/**
 * Where a value leg originated within its parent transaction. `native` is a
 * top-level contract value (a `TransferContract` amount or a `TriggerSmartContract`
 * call-value); `internal` is a TVM transfer performed during contract execution;
 * `token_event` is a TRC20/721 transfer emitted as a contract log.
 */
export type ValueTransferOrigin = 'native' | 'internal' | 'token_event';

/** The asset class a value leg moves. `TRX` is native; the rest are token standards. */
export type ValueAssetType = 'TRX' | 'TRC10' | 'TRC20' | 'TRC721';

/**
 * One discrete value movement: an asset of `amountRaw` moving `from` → `to`
 * inside transaction `txId`, identified within that transaction by
 * `(origin, legKey, assetId)`.
 */
export interface IValueTransfer {
    /** Parent transaction hash. */
    txId: string;
    /** Which part of the transaction produced this leg. */
    origin: ValueTransferOrigin;
    /**
     * Source-independent identity of the leg within its parent transaction: empty
     * for the single `native` leg, the protocol internal-transaction hash for an
     * `internal` leg, the event log index for a `token_event` leg. Combined with
     * `assetId` it uniquely keys a leg, so two legs sharing a parent hash never
     * collide.
     */
    legKey: string;
    /** Asset class moved. */
    assetType: ValueAssetType;
    /** Asset identity: empty for TRX, the TRC10 tokenId, or the TRC20/721 contract address. */
    assetId: string;
    /** Base58 sender. */
    from: string;
    /** Base58 recipient. */
    to: string;
    /**
     * Raw amount as an integer string — sun for TRX, base units (decimals
     * unapplied) for tokens. A string because token amounts exceed 64-bit range.
     */
    amountRaw: string;
    /** Token decimals when the source revealed them; absent when a bare provider cannot. */
    assetDecimals?: number;
    /** Block execution time. */
    timestamp: Date;
    /** Including block height; 0 when the source omits it. */
    blockNumber: number;
}
