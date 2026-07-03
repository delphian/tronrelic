import type { IMigration, IMigrationContext } from '@/types';

/**
 * Add salted source-hash columns (`ip_hash`, `subnet_hash`) to the
 * ClickHouse `traffic_events` table.
 *
 * **Why this migration exists.**
 * The pipeline never stores raw IPs (privacy design), which made analytics
 * unable to answer "are these probes coming from the same source?" — a
 * distributed scanner burst on a nonexistent path (`/ip`, July 2026) was
 * indistinguishable from one noisy client. `ip_hash` is a keyed SHA-256 of
 * the client address (16 hex chars); `subnet_hash` hashes the containing
 * /24 (IPv4) or /48 (IPv6) so address rotation inside one provider block
 * still groups. Both are computed with a server-side salt in
 * `services/ip-hash.ts`, so the stored values are opaque correlation keys,
 * not reversible PII.
 *
 * **Idempotent.** `ADD COLUMN IF NOT EXISTS` is a no-op on re-run. Both
 * columns sit outside the table's `ORDER BY (timestamp, candidate_uid)`
 * key, so adding them is a pure metadata operation with no data rewrite.
 *
 * **Skip behavior.** Skipped with a warning when `CLICKHOUSE_HOST` is
 * unset, matching migrations 010/012/013/014 and `TrafficService`'s no-op
 * posture.
 *
 * **Rollback.**
 * ```sql
 * ALTER TABLE traffic_events DROP COLUMN ip_hash;
 * ALTER TABLE traffic_events DROP COLUMN subnet_hash;
 * ```
 * Forward-only by project convention.
 */
export const migration: IMigration = {
    id: '015_traffic_events_source_hash_columns',
    description:
        'Add Nullable(String) ip_hash and subnet_hash columns to the ClickHouse traffic_events table ' +
        'so analytics can correlate events from the same source (client / provider block) without ' +
        'storing raw IP addresses.',
    target: 'clickhouse',
    dependencies: [
        'module:traffic:010_create_traffic_events_table',
        // `AFTER cf_ipcountry` requires the Cloudflare columns to exist first.
        'module:traffic:014_traffic_events_cloudflare_columns'
    ],

    async up(context: IMigrationContext): Promise<void> {
        if (!context.clickhouse) {
            console.log('[Migration 015] ClickHouse not configured — skipping traffic_events source-hash columns add');
            return;
        }

        await context.clickhouse.exec(`
            ALTER TABLE traffic_events
                ADD COLUMN IF NOT EXISTS ip_hash Nullable(String) AFTER cf_ipcountry,
                ADD COLUMN IF NOT EXISTS subnet_hash Nullable(String) AFTER ip_hash
        `);

        console.log('[Migration 015] Added traffic_events.ip_hash and traffic_events.subnet_hash');
    }
};
