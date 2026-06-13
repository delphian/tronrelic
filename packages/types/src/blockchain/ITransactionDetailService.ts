import type { IBlockTransaction } from './IBlockTransaction.js';

/**
 * Read-through lookup of full transaction detail by id.
 *
 * Backed by a permanent cache (`core_transaction_details`): a cache hit is an
 * indexed local read; a miss fetches the transaction from the block provider,
 * persists it, and returns it. Because a confirmed transaction is immutable,
 * the cache never goes stale.
 *
 * Published on the service registry as `'transaction-details'`. Consume via
 * `services.get<ITransactionDetailService>('transaction-details')`.
 *
 * Cold reads can fail: a cache miss performs network calls to the provider, so
 * implementations may return null when a transaction cannot be resolved (never
 * persisted, unknown id, or provider unavailable). Callers must handle null.
 */
export interface ITransactionDetailService {
    /**
     * Resolve a single transaction by id. Returns null when the transaction
     * cannot be resolved from cache or the provider.
     *
     * @param txId - Transaction hash.
     */
    getTransactionById(txId: string): Promise<IBlockTransaction | null>;

    /**
     * Resolve many transactions by id in one call. Returns only the
     * transactions that resolved; the result may be shorter than the input and
     * its order is not guaranteed to match. Map by `txId` if alignment matters.
     *
     * @param txIds - Transaction hashes.
     */
    getTransactionsByIds(txIds: string[]): Promise<IBlockTransaction[]>;
}
