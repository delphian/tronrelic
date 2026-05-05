import type { IMigration, IMigrationContext } from '@/types';

/**
 * Drop the two indexes that backed the abandoned in-block transaction
 * clustering feature.
 *
 * **Why this migration exists:**
 * The `analysis.relatedTransactions` field and the `analysis.clusterId`
 * field have been removed from the transaction schema. They were populated
 * by an in-block address-graph scan and a `deriveClusterId` stub that
 * never produced a non-undefined value, and no consumer (frontend, plugin,
 * analytics, observer) ever read either field. The schema, type
 * definitions, calculation code, and the lone whale-alerts plugin
 * reference have all been removed in the same change.
 *
 * Mongoose's `autoIndex` only creates indexes that exist in the schema —
 * it does not drop indexes that disappear from it. Without an explicit
 * drop the two indexes linger in MongoDB indefinitely:
 *   - `analysis.relatedTransactions_1` — multikey index on the array
 *     field. New writes no longer populate it, but the index definition
 *     remains and continues to consume cache space.
 *   - `analysis.clusterId_1_timestamp_-1` — compound index. Even though
 *     `clusterId` is no longer written, the compound key still fires on
 *     every transaction insert because `timestamp` is part of it,
 *     wasting CPU on no-value index updates.
 *
 * **Field data is not unset:**
 * The hourly `blockchain:prune` job in `BlockchainService.pruneOldTransactions`
 * `deleteMany`s transactions older than 7 days in 2-hour batches. Every
 * existing document that still carries `analysis.relatedTransactions` or
 * `analysis.clusterId` will be deleted within at most 7 days through
 * normal rotation, so a wholesale `$unset` over the entire collection
 * would just duplicate I/O the prune already does.
 *
 * **Idempotency:**
 * Each `dropIndex` call is wrapped in a try/catch that swallows
 * MongoDB's `IndexNotFound` error (code 27, message contains "not
 * found"). Re-runs after a successful pass are no-ops, and fresh
 * environments that never created the indexes (new dev DBs, CI) skip
 * cleanly. Other errors propagate so the executor can record the
 * failure.
 *
 * **Transaction semantics:**
 * The migration executor wraps `up()` in `session.withTransaction()`
 * when running against a replica set, but `context.database.getCollection()`
 * returns a raw MongoDB collection that does not carry the session, so
 * `dropIndex` runs as a normal DDL operation outside the transaction —
 * the same pattern used by `001_drop_legacy_market_collections.ts` for
 * `collection.drop()`. DDL inside a multi-document transaction is not
 * supported by MongoDB anyway.
 *
 * **Rollback:**
 * Not provided. Recreating the indexes would only be useful to undo a
 * mistaken application of this migration; the application code has
 * already removed every consumer of the underlying fields, so empty
 * indexes would carry no signal.
 */
export const migration: IMigration = {
    id: '002_drop_transaction_clustering_indexes',
    description: 'Drop unused analysis.relatedTransactions_1 and analysis.clusterId_1_timestamp_-1 indexes from the transactions collection. Field data ages out via the existing blockchain:prune job within 7 days.',
    dependencies: [],

    async up(context: IMigrationContext): Promise<void> {
        const transactions = context.database.getCollection('transactions');

        const indexesToDrop = [
            'analysis.relatedTransactions_1',
            'analysis.clusterId_1_timestamp_-1'
        ];

        for (const indexName of indexesToDrop) {
            try {
                await transactions.dropIndex(indexName);
                console.log(`[Migration] Dropped index: ${indexName}`);
            } catch (error) {
                // MongoDB throws IndexNotFound (code 27) with a "not found"
                // message when the index is already absent — expected on
                // re-runs and on fresh environments that never had it.
                if (error instanceof Error && error.message.includes('not found')) {
                    console.log(`[Migration] Skipped (not found): ${indexName}`);
                } else {
                    throw new Error(
                        `Failed to drop index ${indexName} on transactions: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
            }
        }

        console.log('[Migration] Successfully dropped abandoned transaction clustering indexes');
    }
};
