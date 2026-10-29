import type { IMigration, IMigrationContext } from '@/types';

/**
 * Add the source-app column to the ClickHouse `traffic_events` table.
 *
 * **Why this migration exists.**
 * Social and messaging apps open links in an in-app browser that sends no
 * `Referer` header, so a visit from a Douyin caption or a WeChat chat read
 * `direct` on every dashboard surface while the app's name sat unread in the
 * User-Agent column. `source_app` stores that name at write time, classified
 * by `services/source-app-classifier.ts`, so the source bucket can credit a
 * referrer-less visit to the app it came from and the channel classifier can
 * file it under `social`.
 *
 * Rows written before this migration carry NULL and keep reading `direct`,
 * the same forward-only rule every other write-time label follows.
 *
 * **Idempotent.** `ADD COLUMN IF NOT EXISTS` is a no-op on re-run. The
 * column sits outside the `ORDER BY` key, so this is a metadata change only.
 *
 * **Skip behavior.** Skipped with a warning when `CLICKHOUSE_HOST` is
 * unset, matching migrations 010–019 and `TrafficService`'s no-op posture.
 *
 * **Deploy order.** Run before deploying code that writes `source_app`,
 * because inserts carrying the field fail against a table without the
 * column.
 *
 * **Rollback.**
 * ```sql
 * ALTER TABLE traffic_events DROP COLUMN source_app;
 * ```
 * Forward-only by project convention.
 */
export const migration: IMigration = {
    id: '020_traffic_events_source_app_column',
    description:
        'Add LowCardinality(Nullable(String)) source_app column to the ClickHouse traffic_events table so each ' +
        'event records the social or messaging app whose in-app browser it came from, read from the User-Agent.',
    target: 'clickhouse',
    dependencies: [
        'module:traffic:010_create_traffic_events_table',
        // `AFTER asn` requires the asn column to exist first.
        'module:traffic:019_traffic_events_asn_column'
    ],

    /**
     * Add the column, or do nothing when ClickHouse is not configured.
     *
     * @param context - Migration context; only `clickhouse` is used, because
     *                  the column lives in ClickHouse rather than MongoDB.
     * @returns Resolves once the ALTER has been issued or skipped.
     */
    async up(context: IMigrationContext): Promise<void> {
        if (!context.clickhouse) {
            console.log('[Migration 020] ClickHouse not configured — skipping traffic_events source_app column add');
            return;
        }

        await context.clickhouse.exec(`
            ALTER TABLE traffic_events
                ADD COLUMN IF NOT EXISTS source_app LowCardinality(Nullable(String)) AFTER asn
        `);

        console.log('[Migration 020] Added traffic_events.source_app');
    }
};
