import type { IMigration, IMigrationContext } from '@/types';

/**
 * Drop five secondary indexes on the core `transactions` collection that no
 * code path reads, to cut bulk-write latency in the blockchain sync.
 *
 * **Why this migration exists:**
 * Production diagnosis showed the per-block bulk upsert spending ~6.8s of a
 * ~7.4s pipeline persisting to MongoDB. Each of the ~350 upserts per block
 * inserted 11 index keys (`keysInserted: 11` in the slow-query log) while
 * `$indexStats` showed five of those indexes had taken zero reads across 11
 * days of uptime. On an 85M+ document collection whose 23 GB of indexes far
 * exceed the WiredTiger cache, every random-key index insert faults cold
 * B-tree pages from disk — so each unused index converts directly into
 * storage-read stalls inside the write path. A repo-wide audit (core
 * backend, all plugins, ops scripts) confirmed no consumer for any of the
 * five:
 *   - `timestamp_-1` — strictly redundant: `timestamp_1` serves every
 *     descending sort via reverse traversal.
 *   - `blockNumber_1` — no query filters transactions by block; block-level
 *     queries hit the `blocks` collection, which has its own index.
 *   - `memo_1_timestamp_-1` — all memo reads target `transaction_memos` or
 *     the memo-tracker plugin's own prefixed collection (via `$regex`, which
 *     this index could not serve anyway).
 *   - `analysis.pattern_1` — the field is written on every document but
 *     never queried; sibling `analysis.*` indexes were already dropped by
 *     `002_drop_transaction_clustering_indexes`.
 *   - `internalTransactions.hash_1` — zero references repo-wide.
 *
 * The two address indexes (`from.address_1_timestamp_-1`,
 * `to.address_1_timestamp_-1`) are intentionally retained: they back the
 * public account-transaction endpoints and the analytics services, and
 * dropping them would turn account lookups into full collection scans.
 *
 * **Schema alignment:**
 * The same change removes these index declarations from
 * `transaction-model.ts`. Mongoose `autoIndex` only creates indexes present
 * in the schema — it never drops removed ones — so this explicit drop is
 * required for existing environments, while fresh installs simply never
 * create them.
 *
 * **Idempotency:**
 * Each `dropIndex` swallows MongoDB's IndexNotFound (code 27) and
 * NamespaceNotFound (code 26) errors — matched by numeric code, with a
 * message match as fallback — so re-runs and fresh environments skip cleanly.
 * Any other error propagates for the executor to record.
 *
 * **Transaction semantics:**
 * `context.database.getCollection()` returns a raw collection that does not
 * carry the executor's session, so `dropIndex` runs as normal DDL outside
 * any transaction — the same pattern as
 * `002_drop_transaction_clustering_indexes`. MongoDB does not support DDL
 * inside multi-document transactions anyway.
 *
 * **Rollback:**
 * Not provided. Recreating multi-gigabyte indexes on an 85M-document
 * collection is an operator decision (foreground build cost), and the
 * application no longer declares them; restoring one means reverting the
 * schema change and letting `autoIndex` or a manual build recreate it.
 */
export const migration: IMigration = {
    id: '006_drop_unused_transaction_indexes',
    description: 'Drop five read-dead indexes (timestamp_-1, blockNumber_1, memo_1_timestamp_-1, analysis.pattern_1, internalTransactions.hash_1) from the transactions collection to reduce block-sync bulk-write latency. Index-usage stats showed zero reads; a repo-wide audit found no consumer.',
    dependencies: [],

    async up(context: IMigrationContext): Promise<void> {
        const transactions = context.database.getCollection('transactions');

        const indexesToDrop = [
            'timestamp_-1',
            'blockNumber_1',
            'memo_1_timestamp_-1',
            'analysis.pattern_1',
            'internalTransactions.hash_1'
        ];

        for (const indexName of indexesToDrop) {
            try {
                await transactions.dropIndex(indexName);
                console.log(`[Migration] Dropped index: ${indexName}`);
            } catch (error) {
                // Tolerate only "there was nothing to drop": IndexNotFound
                // (code 27) when the named index is already absent, and
                // NamespaceNotFound (code 26) when the collection itself does
                // not exist yet — both expected on re-runs and on fresh
                // environments. Test the stable numeric code first because the
                // server's message wording drifts across versions; the message
                // match is only a fallback for drivers that surface the text
                // without a structured code. Any other failure (permissions,
                // stepdown, transient) propagates for the executor to record.
                const details = error as { code?: number; codeName?: string } | null;
                const message = error instanceof Error ? error.message : String(error);
                const isNothingToDrop =
                    details?.code === 27 ||
                    details?.code === 26 ||
                    details?.codeName === 'IndexNotFound' ||
                    details?.codeName === 'NamespaceNotFound' ||
                    /index not found/i.test(message) ||
                    /ns not found/i.test(message);

                if (isNothingToDrop) {
                    console.log(`[Migration] Skipped (not found): ${indexName}`);
                } else {
                    throw new Error(
                        `Failed to drop index ${indexName} on transactions: ${message}`
                    );
                }
            }
        }

        console.log('[Migration] Successfully dropped unused transaction indexes');
    }
};
