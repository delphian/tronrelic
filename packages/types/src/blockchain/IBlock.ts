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
    /** Timestamp when TronRelic processed this block */
    processedAt: Date;
}
