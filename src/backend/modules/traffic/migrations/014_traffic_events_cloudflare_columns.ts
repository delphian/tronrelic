import type { IMigration, IMigrationContext } from '@/types';

/**
 * Add Cloudflare edge columns (`cf_ray`, `cf_ipcountry`) to the ClickHouse
 * `traffic_events` table.
 *
 * **Why this migration exists.**
 * Production traffic showed vulnerability scanners (probe paths like `/.env`,
 * encoded path traversal) landing in analytics with spoofed google.com
 * referrers. The single most important question that data could not answer
 * was *how the request reached the origin*: through Cloudflare (a WAF-tuning
 * problem) or direct-to-origin (a firewall problem). `cf_ray` answers it —
 * the Next.js middleware forwards the `CF-Ray` header on the bootstrap call,
 * so a NULL on a production row means the request bypassed Cloudflare.
 * `cf_ipcountry` stores Cloudflare's authoritative edge-derived country
 * alongside the local GeoIP `country` so the two sources can be compared.
 *
 * **Idempotent.** `ADD COLUMN IF NOT EXISTS` is a no-op on re-run. Both
 * columns sit outside the table's `ORDER BY (timestamp, candidate_uid)` key,
 * so adding them is a pure metadata operation with no data rewrite.
 *
 * **Skip behavior.** Skipped with a warning when `CLICKHOUSE_HOST` is unset,
 * matching migrations 010/012/013 and `TrafficService`'s no-op posture.
 *
 * **Rollback.**
 * ```sql
 * ALTER TABLE traffic_events DROP COLUMN cf_ray;
 * ALTER TABLE traffic_events DROP COLUMN cf_ipcountry;
 * ```
 * Forward-only by project convention.
 */
export const migration: IMigration = {
    id: '014_traffic_events_cloudflare_columns',
    description:
        'Add Nullable(String) cf_ray and LowCardinality(Nullable(String)) cf_ipcountry columns to the ' +
        'ClickHouse traffic_events table so analytics can distinguish Cloudflare-proxied traffic from ' +
        'direct-to-origin hits and compare edge geo against local GeoIP.',
    target: 'clickhouse',
    dependencies: ['module:traffic:010_create_traffic_events_table'],

    async up(context: IMigrationContext): Promise<void> {
        if (!context.clickhouse) {
            console.log('[Migration 014] ClickHouse not configured — skipping traffic_events Cloudflare columns add');
            return;
        }

        await context.clickhouse.exec(`
            ALTER TABLE traffic_events
                ADD COLUMN IF NOT EXISTS cf_ray Nullable(String) AFTER sec_fetch_site,
                ADD COLUMN IF NOT EXISTS cf_ipcountry LowCardinality(Nullable(String)) AFTER cf_ray
        `);

        console.log('[Migration 014] Added traffic_events.cf_ray and traffic_events.cf_ipcountry');
    }
};
