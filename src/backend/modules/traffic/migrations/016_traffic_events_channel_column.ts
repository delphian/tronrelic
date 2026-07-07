import type { IMigration, IMigrationContext } from '@/types';

/**
 * Add the acquisition-channel column to the ClickHouse `traffic_events`
 * table.
 *
 * **Why this migration exists.**
 * Channel classification (direct / organic / paid / social / email / ai /
 * referral) previously lived as a display-time regex in the frontend, so
 * the backend, AI tools, and any report had no channel concept, and paid
 * traffic was indistinguishable from organic because UTM medium never
 * participated. Storing the classification at write time (see
 * `services/channel-classifier.ts`) makes channel a first-class GROUP BY
 * dimension with one canonical definition.
 *
 * Rows written before this migration carry NULL; reads fall back to
 * classifying the referrer domain server-side, so legacy rows still bucket.
 *
 * **Idempotent.** `ADD COLUMN IF NOT EXISTS` is a no-op on re-run. The
 * column sits outside the `ORDER BY` key — pure metadata change.
 *
 * **Skip behavior.** Skipped with a warning when `CLICKHOUSE_HOST` is
 * unset, matching migrations 010–015 and `TrafficService`'s no-op posture.
 *
 * **Deploy order.** Run before deploying code that writes `channel` —
 * inserts carrying the field fail against a table without the column.
 *
 * **Rollback.**
 * ```sql
 * ALTER TABLE traffic_events DROP COLUMN channel;
 * ```
 * Forward-only by project convention.
 */
export const migration: IMigration = {
    id: '016_traffic_events_channel_column',
    description:
        'Add LowCardinality(Nullable(String)) channel column to the ClickHouse traffic_events table ' +
        'so acquisition-channel classification (direct/organic/paid/social/email/ai/referral) is a ' +
        'stored write-time dimension instead of a frontend display heuristic.',
    target: 'clickhouse',
    dependencies: [
        'module:traffic:010_create_traffic_events_table',
        // `AFTER subnet_hash` requires the source-hash columns to exist first.
        'module:traffic:015_traffic_events_source_hash_columns'
    ],

    async up(context: IMigrationContext): Promise<void> {
        if (!context.clickhouse) {
            console.log('[Migration 016] ClickHouse not configured — skipping traffic_events channel column add');
            return;
        }

        await context.clickhouse.exec(`
            ALTER TABLE traffic_events
                ADD COLUMN IF NOT EXISTS channel LowCardinality(Nullable(String)) AFTER subnet_hash
        `);

        console.log('[Migration 016] Added traffic_events.channel');
    }
};
