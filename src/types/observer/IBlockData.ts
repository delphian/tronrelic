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
    /** All enriched transactions from this block */
    transactions: ITransaction[];
}
