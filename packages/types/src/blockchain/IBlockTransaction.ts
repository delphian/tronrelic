/**
 * Source-independent domain record for a single blockchain transaction.
 *
 * Every field is an on-chain fact or a deterministic conversion of one, so any
 * block provider — TronGrid today, a node RPC or a ClickHouse mirror tomorrow —
 * is obligated to populate it. Service-derived enrichments (USD valuation,
 * address labels, pattern/risk analysis) are intentionally absent: this models
 * what the chain itself records, not what a particular pipeline layers on top.
 *
 * Contrast with `ITransaction` (the observer-delivery envelope), which carries
 * provider-shaped artifacts (`rawValue`, `info`, `snapshot`) and is therefore
 * not a source-independent contract. See
 * `docs/system/system-domain-types.md` for the admission rule this type obeys.
 */

/**
 * A party to a transaction.
 *
 * Base58 address only. Names, labels, and exchange classification are
 * TronRelic enrichments sourced from other services, not properties of the
 * on-chain record, and are deliberately excluded.
 */
export interface IBlockTransactionParty {
    /** Base58 address (`owner_address` for the sender, `to_address` for the recipient). */
    address: string;
}

/**
 * Per-resource accounting exactly as the chain reports it.
 *
 * TRON records, for each resource, the units drawn from the account and the
 * TRX (in sun) burned when that resource was insufficient. There is no
 * per-unit price on a transaction — unit prices are network-wide protocol
 * parameters, so they belong to chain-parameter state, never to this record.
 */
export interface IResourceUsage {
    /** Units consumed: `net_usage` for bandwidth, `energy_usage` for energy. */
    consumed: number;
    /** TRX burned in sun when the resource was insufficient: `net_fee` or `energy_fee`. */
    feeSun: number;
}

/**
 * Smart-contract call detail for transactions that invoke one.
 */
export interface IBlockTransactionContract {
    /** Base58 address of the called contract (`contract_address`). */
    address: string;
    /** Decoded method selector or name, when resolvable. */
    method?: string;
    /**
     * Decoded ABI arguments. This is a genuinely open domain — the argument
     * shape varies per contract method — and any provider decoding the same
     * call yields the same map, so it remains source-independent. Distinct
     * from an un-modeled provider envelope, which this type forbids.
     */
    parameters?: Record<string, unknown>;
}

/**
 * A blockchain transaction projected to its source-independent essentials.
 *
 * Returned by read methods on `IBlockchainService`. Optional fields are absent
 * when the transaction type does not carry them (e.g. `amountSun` for a TRC20
 * call, whose token amount lives in the contract data rather than the native
 * value field), never as a placeholder for missing-but-expected data.
 */
export interface IBlockTransaction {
    /** Transaction hash. */
    txId: string;
    /** Height of the block that included this transaction. */
    blockNumber: number;
    /** Block execution time, from the native `blockTimeStamp`. */
    timestamp: Date;
    /** Native contract type, e.g. `'TransferContract'`, `'TriggerSmartContract'`. */
    type: string;
    /**
     * Native execution result from `ret.contractRet`, e.g. `'SUCCESS'`,
     * `'REVERT'`, `'OUT_OF_ENERGY'`, `'OUT_OF_TIME'`. Typed as `string` rather
     * than a closed union so new protocol result codes cannot stale the
     * contract.
     */
    status: string;
    /** Sender. */
    from: IBlockTransactionParty;
    /** Recipient. */
    to: IBlockTransactionParty;
    /**
     * Native TRX value moved, in sun. Absent for transactions that carry no
     * native value (e.g. TRC20 transfers via `TriggerSmartContract`).
     */
    amountSun?: number;
    /**
     * Total TRX burned by the transaction, in sun, from the native `fee`:
     * resource fees plus account activation, memo, multi-signature, and other
     * fees. A superset of the per-resource `feeSun` values.
     */
    feeSun?: number;
    /** Energy accounting from the receipt. */
    energy?: IResourceUsage;
    /** Bandwidth ("net") accounting from the receipt. */
    bandwidth?: IResourceUsage;
    /** Smart-contract call detail, when the transaction invoked a contract. */
    contract?: IBlockTransactionContract;
    /** Decoded memo from the native `raw_data.data` field; null when none. */
    memo?: string | null;
}
