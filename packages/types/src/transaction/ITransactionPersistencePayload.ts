/**
 * Complete transaction data prepared for database persistence.
 *
 * This interface represents a fully enriched blockchain transaction ready for storage.
 * All addresses are converted to Base58 format, amounts are calculated in both sun and
 * TRX units, and USD conversions are complete. This abstraction isolates observers from
 * database implementation details while providing all necessary transaction context.
 */
import type { ITokenTransfer } from './ITokenTransfer.js';
import type { IContractEvent } from './IContractEvent.js';
import type { ITokenTransferEvent } from './ITokenTransferEvent.js';
import type { IInternalTransfer } from './IInternalTransfer.js';

export interface ITransactionPersistencePayload {
    /** Unique transaction identifier from the blockchain */
    txId: string;
    /** Block number containing this transaction */
    blockNumber: number;
    /**
     * Zero-based position of this transaction in its block, as the block lists
     * it. The chain executes a block's transactions in that order, so an
     * observer relating two transactions from one block — a delegation and the
     * reclaim that follows it — needs this value. Every transaction in a block
     * shares one timestamp, and observers receive a block's batch grouped by
     * transaction type, so neither can recover the order.
     *
     * Counted before sync skips anything, so the value matches the chain even
     * when a transaction without contract data is dropped.
     *
     * Optional because it is set only on transactions delivered by block sync.
     * It is not written to the transactions collection: no stored read needs it,
     * and the field would add bytes to every document on a collection whose
     * per-block write size is kept deliberately small. Documents read back from
     * the database, and transactions fetched one at a time, do not carry it.
     */
    transactionIndex?: number;
    /** Transaction execution timestamp */
    timestamp: Date;
    /** Primary transaction type (TransferContract, TriggerSmartContract, etc.) */
    type: string;
    /** Optional sub-categorization for complex transaction types */
    subType?: string;
    /**
     * Native execution result from the transaction's `ret[].contractRet`
     * (e.g. 'SUCCESS', 'REVERT', 'OUT_OF_ENERGY'). Optional: absent on records
     * persisted before status capture was added, populated for all new rows.
     */
    status?: string;
    /** Source address with enriched metadata (exchange vs wallet, known names) */
    from: {
        address: string;
        name?: string | null;
        type?: string | null;
        labels?: string[];
        description?: string | null;
    };
    /** Destination address with enriched metadata */
    to: {
        address: string;
        name?: string | null;
        type?: string | null;
        labels?: string[];
        description?: string | null;
    };
    /** Transaction amount in sun (smallest unit) */
    amount?: number;
    /** Transaction amount in TRX */
    amountTRX?: number;
    /** Transaction amount in USD at execution time */
    amountUSD?: number;
    /** Energy resource consumption and cost details */
    energy?: {
        consumed: number;
        price: number;
        totalCost: number;
    };
    /** Bandwidth resource consumption and cost details */
    bandwidth?: {
        consumed: number;
        price: number;
        totalCost: number;
    };
    /** Smart contract details if transaction involves a contract */
    contract?: {
        address: string;
        method?: string;
        parameters?: Record<string, unknown>;
    };
    /**
     * The TRC20 token transfer this call requested, decoded from `contract`'s
     * call data. Set only on `TriggerSmartContract` transactions that call a
     * standard `transfer` or `transferFrom`; absent otherwise.
     *
     * Delivered to observers only. It is not written to the transactions
     * collection, because the call data it comes from is already stored there
     * and the transactions collection is kept deliberately small per block.
     * Documents read back from the database do not carry it.
     *
     * It is not proof that tokens moved. A call that reverted is still
     * decoded, so check `status === 'SUCCESS'` first, but that check rules
     * out reverts only: a non-standard token that returns `false` instead of
     * reverting also ends as `'SUCCESS'` with nothing moved.
     *
     * It also sees only a direct call to the token. For every token movement
     * the transaction caused, including ones inside another contract's call,
     * read `tokenTransfers` instead. This field keeps its call-data meaning so
     * existing consumers do not change behaviour without their knowledge.
     */
    tokenTransfer?: ITokenTransfer;
    /**
     * Every event log the transaction emitted, normalised with base58
     * addresses and a stable `eventId`, in emission order.
     *
     * Set only when the block's receipts were fetched in full
     * (`IBlockData.receiptsFetched`). A reverted transaction emits nothing and
     * gets an empty list. Absent when receipts were not fetched, which means
     * "unknown", not "no events".
     *
     * Delivered to observers only and not written to the transactions
     * collection.
     */
    events?: IContractEvent[];
    /**
     * Token movements the transaction caused, decoded from standard
     * `Transfer` events, or from call data when receipts were not fetched.
     * Check each entry's `source` to tell the two apart; the list never mixes
     * them. See `ITokenTransferEvent`.
     *
     * Always set on transactions delivered by block sync, possibly empty.
     * Delivered to observers only and not written to the transactions
     * collection.
     */
    tokenTransfers?: ITokenTransferEvent[];
    /**
     * Value-bearing TRX and TRC10 movements made by contracts during the
     * transaction, decoded from the receipt's internal transactions.
     *
     * Set only when the block's receipts were fetched in full, possibly empty.
     * Absent otherwise. Delivered to observers only and not written to the
     * transactions collection; the raw list is stored as
     * `internalTransactions`.
     */
    internalTransfers?: IInternalTransfer[];
    /** Optional transaction memo or note */
    memo?: string | null;
    /**
     * Internal transactions triggered by smart contract execution.
     *
     * Absent rather than empty when there are none, so the field is not written
     * on the majority of transactions that trigger nothing. Absent also when
     * receipts were not fetched for the block at all, which is the default — so
     * a missing value does not mean the transaction triggered nothing, only that
     * nothing is known. Read `IBlockData.receiptsFetched` to tell the two apart,
     * and count a missing value as zero rather than dereferencing it.
     */
    internalTransactions?: unknown[];
    /** Notification channels that should be triggered for this transaction */
    notifications?: string[];
    /** Advanced pattern analysis and risk scoring */
    analysis?: {
        relatedAddresses?: string[];
        pattern?: 'accumulation' | 'distribution' | 'arbitrage' | 'exchange_reshuffle' |
                  'exchange_outflow' | 'exchange_inflow' | 'self_shuffle' |
                  'cluster_distribution' | 'mega_whale' | 'delegation' | 'stake' |
                  'token_creation' | 'unknown';
        riskScore?: number;
        confidence?: number;
    };
}
