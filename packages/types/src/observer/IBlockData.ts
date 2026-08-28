import type { ITransaction } from '../transaction/ITransaction.js';

/**
 * Block data passed to block observers.
 *
 * Contains block metadata and all enriched transactions from the block. Block observers
 * receive this structure after all transactions in a block have been processed, enabling
 * cross-transaction analysis and block-level metrics calculation.
 */
export interface IBlockData {
    /** Block number (height) on the TRON network */
    blockNumber: number;
    /** Unique block identifier hash */
    blockId: string;
    /** Hash of the parent block */
    parentHash: string;
    /** Base58 address of the super representative that produced this block */
    witnessAddress: string;
    /** Block timestamp */
    timestamp: Date;
    /** Total number of transactions in the block */
    transactionCount: number;
    /** Block size in bytes (optional, may not be available from all sources) */
    size?: number;
    /**
     * Whether every transaction in this block had its receipt retrieved.
     *
     * Check this before reading any transaction's `energy`, `bandwidth`, or
     * `internalTransactions`, or any block-level total derived from them. Sync
     * fetches receipts only when an operator has enabled it, and when it has not
     * those fields are absent and the totals are exactly zero — indistinguishable
     * from a transaction that consumed nothing. An observer that ignores this
     * flag will read structural zeros as measurements.
     *
     * True only when the data is complete: a block with no transactions counts
     * as true, while a failed or partial receipt fetch counts as false, because
     * an undercount should not be treated as a measurement.
     *
     * Optional so that a block assembled by an older code path, or by a source
     * that does not supply receipts at all, is not forced to claim either
     * answer. Treat a missing value the same as `false`.
     */
    receiptsFetched?: boolean;
    /** All enriched transactions from this block */
    transactions: ITransaction[];
}
