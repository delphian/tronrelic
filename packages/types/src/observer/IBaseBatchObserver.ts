import type { IBaseObserver } from './IBaseObserver.js';
import type { ITransaction } from '../transaction/ITransaction.js';

/**
 * Interface for batch transaction observers.
 *
 * Batch observers subscribe to specific transaction types and receive all matching
 * transactions from a block at once, rather than individually. This enables efficient
 * bulk processing patterns such as batch database inserts or aggregated analytics.
 *
 * Batch observers use internal queuing similar to regular observers, processing
 * batches serially to maintain predictable resource usage.
 */
export interface IBaseBatchObserver extends IBaseObserver {
    /**
     * Enqueue a batch of transactions for processing.
     *
     * Adds the transaction array to the internal queue and triggers processing if not
     * already running. If the queue exceeds the maximum batch count, the implementation
     * should log an error and clear the queue to prevent memory overflow.
     *
     * @param transactions - Array of enriched transactions of the subscribed type from a single block
     */
    enqueueBatch(transactions: ITransaction[]): Promise<void>;
}
