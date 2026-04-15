import type { IBaseObserver } from './IBaseObserver.js';
import type { ITransaction } from '../transaction/ITransaction.js';

/**
 * Batched transactions grouped by transaction type.
 *
 * Keys are transaction type strings (e.g., 'DelegateResourceContract').
 * Values are arrays of enriched transactions of that type from a single block.
 * Empty types are omitted from the record.
 */
export type TransactionBatches = Record<string, ITransaction[]>;

/**
 * Interface for batch transaction observers.
 *
 * Batch observers subscribe to one or more transaction types and receive all matching
 * transactions from a block at once, grouped by type. This enables efficient bulk
 * processing patterns such as batch database inserts, aggregated analytics, and
 * atomic cross-type operations.
 *
 * Observers subscribing to multiple types receive a single callback per block containing
 * all subscribed types that had transactions (empty types are omitted).
 *
 * Batch observers use internal queuing similar to regular observers, processing
 * batches serially to maintain predictable resource usage.
 */
export interface IBaseBatchObserver extends IBaseObserver {
    /**
     * Enqueue a batch of transactions for processing.
     *
     * Adds the transaction batches to the internal queue and triggers processing if not
     * already running. If the queue exceeds the maximum batch count, the implementation
     * should log an error and clear the queue to prevent memory overflow.
     *
     * @param batches - Record mapping transaction types to arrays of enriched transactions from a single block
     */
    enqueueBatch(batches: TransactionBatches): Promise<void>;
}
