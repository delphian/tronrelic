/**
 * The transaction receipt block sync attaches to each transaction as
 * `ITransaction.info`, in the shape TronGrid returns it.
 *
 * Typed so an observer reading the fields core already relies on gets a
 * compile-time check instead of `any`. The field names are TronGrid's own,
 * because this is the raw receipt; prefer the decoded payload fields
 * (`energy`, `bandwidth`, `events`, `tokenTransfers`, `internalTransfers`)
 * where they cover what you need, since those stay stable if the provider
 * changes.
 *
 * A receipt is present only when an operator has switched `fetchBlockReceipts`
 * on and the fetch for the block succeeded.
 */
export interface ITransactionReceipt {
    /** Transaction id, as hex. */
    id: string;

    /** Total fee paid, in SUN. */
    fee?: number;

    /** Height of the block that holds the transaction. */
    blockNumber?: number;

    /** Block timestamp in milliseconds. */
    blockTimeStamp?: number;

    /** Resource usage and the execution result. */
    receipt?: {
        /** Energy consumed, including energy covered by staking or delegation. */
        energy_usage_total?: number;
        /** Energy paid for by burning TRX, in SUN. */
        energy_fee?: number;
        /** Bandwidth consumed. */
        net_usage?: number;
        /** Bandwidth paid for by burning TRX, in SUN. */
        net_fee?: number;
        /** TVM result, for example `'SUCCESS'` or `'REVERT'`. */
        result?: string;
    };

    /**
     * Hex return values of the contract call. A standard TRC20 `transfer`
     * returns a 32-byte boolean here.
     */
    contractResult?: string[];

    /**
     * Raw event logs. `address` is 40 hex characters without TRON's `41`
     * prefix. Read `ITransactionPersistencePayload.events` instead, which
     * carries the same logs with base58 addresses and a stable identity.
     */
    log?: Array<{
        address?: string;
        topics?: string[];
        data?: string;
    }>;

    /**
     * Raw internal transactions. Read
     * `ITransactionPersistencePayload.internalTransfers` instead, which carries
     * the value-bearing ones decoded.
     */
    internal_transactions?: Array<Record<string, unknown>>;

    /** TRC10 token id created by an asset-issue transaction. */
    assetIssueID?: string;

    /** `'FAILED'` when the transaction failed; absent on success. */
    result?: string;

    /** Hex-encoded failure message. */
    resMessage?: string;
}
