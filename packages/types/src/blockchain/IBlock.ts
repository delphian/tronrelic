import type { IBlockStats } from './IBlockStats.js';

/**
 * Processed blockchain block data.
 * Represents a block that has been fetched from the network and persisted to the database.
 */
export interface IBlock {
    /** Block height on the TRON network */
    blockNumber: number;
    /** Unique block identifier hash */
    blockId: string;
    /** Hash of the previous block */
    parentHash: string;
    /** Address of the super representative that produced this block */
    witnessAddress: string;
    /** Block timestamp from the network */
    timestamp: Date;
    /** Number of transactions in this block */
    transactionCount: number;
    /** Block size in bytes */
    size?: number;
    /** Aggregated transaction statistics */
    stats: IBlockStats;
    /**
     * Whether every transaction in this block had its receipt retrieved when
     * the block was indexed.
     *
     * Check this before reading `stats.totalEnergyUsed`,
     * `stats.totalEnergyCost`, `stats.totalBandwidthUsed`, or
     * `stats.internalTransactions`. Sync fetches receipts only when an operator
     * has enabled it, so with it off all four are exactly zero — the same value
     * a block that genuinely burned nothing would carry. A failed or partial
     * fetch is `false` as well, because an undercount is not a measurement.
     *
     * Optional because blocks indexed before the field existed do not carry it,
     * and their receipts were never fetched, so a missing value means `false`.
     */
    receiptsFetched?: boolean;
    /** Timestamp when TronRelic processed this block */
    processedAt: Date;
}
