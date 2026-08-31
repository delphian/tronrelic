import type { IMigration, IMigrationContext } from '@/types';

/**
 * Drop the redundant `timestamp_1` and `service_1` indexes from the
 * `system_logs` collection, so existing deployments actually stop paying for
 * the duplicate index writes the schema change removed.
 *
 * **Why this migration exists:**
 * `SystemLog.ts` no longer declares `index: true` on `timestamp` or `service`.
 * Each field is the leading field of a compound index the schema still
 * declares — `{ timestamp: -1, level: 1, resolved: 1 }` and
 * `{ service: 1, timestamp: -1 }` — and MongoDB can use a compound index for a
 * query that matches its leading field, and can walk an index in either
 * direction, so the single-field copies answer nothing the compound indexes do
 * not already answer.
 *
 * Removing the declaration is not enough on its own. Mongoose `autoIndex` only
 * creates indexes present in the schema; it never drops indexes that disappear
 * from it. Without this explicit drop, every environment that has already
 * booted the old schema keeps both physical indexes, so it keeps the extra
 * index write on every log insert and the disk the index files hold. Fresh
 * installs simply never create them.
 *
 * The write cost is what matters here. Retention churns this collection
 * constantly, so a duplicate index is updated on every insert and delete, and
 * WiredTiger leaves an index file sitting at its high-water mark, meaning the
 * copy keeps its space long after the documents it indexed are gone.
 *
 * **Why `level_1` and `resolved_1` are kept:**
 * Both fields sit in the second and third positions of the compound index, and
 * MongoDB can only use a compound index for a query matching its leading
 * fields, so a filter on `level` or `resolved` alone cannot use it. Those two
 * single-field indexes are still declared on the schema and are left alone.
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
 * transaction — the same pattern as `006_drop_unused_transaction_indexes` and
 * `007_drop_unused_block_indexes`. MongoDB does not support DDL inside
 * multi-document transactions anyway.
 *
 * **Rollback:**
 * Not provided. The application no longer declares either index, so restoring
 * one means reverting the schema change and letting `autoIndex` or a manual
 * build recreate it.
 */
export const migration: IMigration = {
    id: '001_drop_redundant_system_log_indexes',
    description: 'Drop the redundant timestamp_1 and service_1 indexes from system_logs. Each field is the leading field of a compound index the schema still declares, so the single-field copies serve no query while costing an index write on every log insert. Mongoose never drops indexes removed from a schema, so upgraded deployments need this explicit drop.',
    dependencies: [],

    async up(context: IMigrationContext): Promise<void> {
        const systemLogs = context.database.getCollection('system_logs');

        const indexesToDrop = ['timestamp_1', 'service_1'];

        for (const indexName of indexesToDrop) {
            try {
                await systemLogs.dropIndex(indexName);
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
                        `Failed to drop index ${indexName} on system_logs: ${message}`
                    );
                }
            }
        }

        console.log('[Migration] Successfully dropped redundant system log indexes');
    }
};
