import type { IMigration, IMigrationContext } from '@/types';

/**
 * Add the autonomous system number (ASN) column to the ClickHouse
 * `traffic_events` table.
 *
 * **Why this migration exists.**
 * An ASN identifies the network operator a request came from, such as a
 * cloud provider or a residential carrier. Diagnosing automated traffic
 * needs that answer, and it cannot be recovered later: the table stores
 * only keyed hashes of the client address (migration 015), never the
 * address itself. Before this column, naming the network behind a burst of
 * suspicious rows meant reading raw addresses out of the Nginx access log.
 *
 * The value comes from Cloudflare. A zone Transform Rule sets the
 * `x-client-asn` request header to `to_string(ip.src.asnum)`, and
 * `buildTrafficEvent` stores it only when `CF-Ray` is also present, the
 * same rule it applies to `CF-IPCountry`. Rows written before this
 * migration, rows from requests that bypassed Cloudflare, and every row
 * written before the Transform Rule exists all carry NULL.
 *
 * **Idempotent.** `ADD COLUMN IF NOT EXISTS` is a no-op on re-run. The
 * column sits outside the `ORDER BY` key, so this is a metadata change only.
 *
 * **Skip behavior.** Skipped with a warning when `CLICKHOUSE_HOST` is
 * unset, matching migrations 010–016 and `TrafficService`'s no-op posture.
 *
 * **Deploy order.** Run before deploying code that writes `asn`, because
 * inserts carrying the field fail against a table without the column.
 *
 * **Rollback.**
 * ```sql
 * ALTER TABLE traffic_events DROP COLUMN asn;
 * ```
 * Forward-only by project convention.
 */
export const migration: IMigration = {
    id: '019_traffic_events_asn_column',
    description:
        'Add Nullable(UInt32) asn column to the ClickHouse traffic_events table so each event records ' +
        'the autonomous system number of the network it came from, as reported by Cloudflare.',
    target: 'clickhouse',
    dependencies: [
        'module:traffic:010_create_traffic_events_table',
        // `AFTER channel` requires the channel column to exist first.
        'module:traffic:016_traffic_events_channel_column'
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
            console.log('[Migration 019] ClickHouse not configured — skipping traffic_events asn column add');
            return;
        }

        await context.clickhouse.exec(`
            ALTER TABLE traffic_events
                ADD COLUMN IF NOT EXISTS asn Nullable(UInt32) AFTER channel
        `);

        console.log('[Migration 019] Added traffic_events.asn');
    }
};
