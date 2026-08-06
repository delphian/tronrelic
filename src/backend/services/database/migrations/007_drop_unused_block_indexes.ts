import type { IMigration, IMigrationContext } from '@/types';

/**
 * Drop the read-dead `witnessAddress_1_timestamp_-1` index from the `blocks`
 * collection, so the field stops costing an index write on every block insert.
 *
 * **Why this migration exists:**
 * `$indexStats` on production showed this index taking zero reads across 12.3
 * days of mongod uptime while occupying 0.15 GB, and a repo-wide audit (core
 * backend, all plugins, ops scripts) found no consumer: `witnessAddress` is
 * written by `blockchain.service.ts` when a block is persisted and is never
 * filtered, sorted, or matched on anywhere. It backed no endpoint, no
 * analytics service, and no admin view.
 *
 * The cost is on the write path rather than in raw bytes. Stage 7 of the
 * per-block pipeline upserts one block document per block — roughly 28,800 per
 * day — and the collection's index working set, like the far larger
 * `transactions` collection audited in `006_drop_unused_transaction_indexes`,
 * does not fit the WiredTiger cache. Every index-key insert therefore risks
 * faulting a cold B-tree page from disk, so an index nothing reads converts
 * entirely into storage-read stalls inside the upsert.
 *
 * **Why `blockId_1` is deliberately kept:**
 * It also shows zero reads, and no query filters on `blockId`. It is retained
 * anyway because it is declared `unique: true` on the schema, so it is not
 * serving lookups — it is enforcing a constraint. That constraint is distinct
 * from the one `blockNumber`'s own unique index provides: `blockNumber` rejects
 * two documents at the same height, while `blockId` rejects two documents
 * carrying the same block hash, which is what would catch the same block being
 * written under a wrong or shifted height. Dropping it would trade 0.53 GB for
 * losing that second guard, which is not a trade this migration is willing to
 * make.
 *
 * **Schema alignment:**
 * The same change removes the index declaration from `block-model.ts`. Mongoose
 * `autoIndex` only creates indexes present in the schema — it never drops
 * removed ones — so this explicit drop is required for existing environments,
 * while fresh installs simply never create it.
 *
 * **Idempotency:**
 * `dropIndex` swallows MongoDB's IndexNotFound (code 27) and NamespaceNotFound
 * (code 26) errors — matched by numeric code, with a message match as fallback
 * — so re-runs and fresh environments skip cleanly. Any other error propagates
 * for the executor to record.
 *
 * **Transaction semantics:**
 * `context.database.getCollection()` returns a raw collection that does not
 * carry the executor's session, so `dropIndex` runs as normal DDL outside any
 * transaction — the same pattern as `006_drop_unused_transaction_indexes`.
 * MongoDB does not support DDL inside multi-document transactions anyway.
 *
 * **Rollback:**
 * Not provided. Recreating the index is an operator decision, and the
 * application no longer declares it; restoring it means reverting the schema
 * change and letting `autoIndex` or a manual build recreate it.
 */
export const migration: IMigration = {
    id: '007_drop_unused_block_indexes',
    description: 'Drop the read-dead witnessAddress_1_timestamp_-1 index from the blocks collection to remove an index write from every block upsert. Index-usage stats showed zero reads over 12.3 days; a repo-wide audit found no consumer. blockId_1 is retained because it enforces uniqueness rather than serving queries.',
    dependencies: [],

    async up(context: IMigrationContext): Promise<void> {
        const blocks = context.database.getCollection('blocks');

        const indexesToDrop = ['witnessAddress_1_timestamp_-1'];

        for (const indexName of indexesToDrop) {
            try {
                await blocks.dropIndex(indexName);
                console.log(`[Migration] Dropped index: ${indexName}`);
            } catch (error) {
                // Tolerate only "there was nothing to drop": IndexNotFound (code
                // 27) when the named index is already absent, and
                // NamespaceNotFound (code 26) when the collection itself does not
                // exist yet — both expected on re-runs and on fresh environments.
                // Test the stable numeric code first because the server's message
                // wording drifts across versions; the message match is only a
                // fallback for drivers that surface the text without a structured
                // code. Any other failure (permissions, stepdown, transient)
                // propagates for the executor to record.
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
                        `Failed to drop index ${indexName} on blocks: ${message}`
                    );
                }
            }
        }

        console.log('[Migration] Successfully dropped unused block indexes');
    }
};
