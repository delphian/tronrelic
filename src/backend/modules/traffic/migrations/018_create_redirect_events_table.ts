import type { IMigration, IMigrationContext } from '@/types';

/**
 * Create the ClickHouse `redirect_events` table that backs redirect analytics.
 *
 * **Why this migration exists.**
 * Admin-managed URL redirects (`module_traffic_redirects`) are served by the
 * Next.js edge middleware, which issues the 301/302 and returns before any
 * analytics beacon runs — so a served redirect left no trace anywhere. Operators
 * could not answer the questions that decide whether a rule earns its keep:
 * which legacy URLs are still being hit, which get zero traffic (safe to remove),
 * and whether that traffic is humans or bots. This table captures one row per
 * served redirect so the `/system/traffic` Redirects tab can render a windowed
 * trend and a per-pattern breakdown.
 *
 * **Why a separate table, not a `traffic_events` event_type.**
 * `traffic_events` carries the visitor/pageview/source Metrics Contract, defined
 * implicitly across many reads keyed on `event_type IN ('bootstrap','page')` and
 * `candidate_uid`. Adding a redirect `event_type` there would risk polluting
 * those counts and force auditing every read. Redirect hits are raw counts (not
 * tid-keyed unique visitors), so they live in their own isolated table.
 *
 * **What this migration does.**
 *   1. Creates table `redirect_events` keyed by `(timestamp, pattern)` so admin
 *      time-range scans and per-pattern group-bys hit a contiguous key prefix.
 *   2. Sets an 18-month TTL aligned with the `traffic_events` retention posture.
 *      Rows expire automatically — no application-side pruning required.
 *
 * **Schema.**
 *   - `timestamp` — server wall clock at redirect time, `DateTime64(3, 'UTC')`
 *     matching `traffic_events` so the same UTC wire-format helper serializes it.
 *   - `pattern` — the matched rule's source pattern (the grouping key). Bounded
 *     cardinality, so `LowCardinality(String)`.
 *   - `path` — the actual requested path. For a prefix rule this shows which
 *     sub-paths are hit; `String` because it is unbounded.
 *   - `destination` / `permanent` — where the rule pointed and whether it was a
 *     301 (`1`) or 302 (`0`), captured as-of hit time.
 *   - `bot_class` — the request's classification (`classifyTrafficRequest`), so
 *     the dashboard's humans-only filter works exactly like the other panels.
 *   - `country` — Cloudflare edge country (`CF-IPCountry`), `''` when unknown.
 *
 * **Idempotent.** `CREATE TABLE IF NOT EXISTS` is a no-op on subsequent runs.
 *
 * **Skip behavior.** If `CLICKHOUSE_HOST` is not configured the migration runner
 * skips this migration with a warning; `TrafficService` already no-ops its
 * redirect write and read when ClickHouse is unavailable, so a deploy without
 * ClickHouse simply records no redirect analytics.
 *
 * **Rollback.**
 * ```sql
 * DROP TABLE IF EXISTS redirect_events;
 * ```
 * Forward-only by project convention.
 */
export const migration: IMigration = {
    id: '018_create_redirect_events_table',
    description:
        'Create ClickHouse redirect_events MergeTree table (18-month TTL, ordered by ' +
        '(timestamp, pattern)) to capture one row per served admin-managed URL redirect ' +
        'so the /system/traffic Redirects tab can render windowed hit analytics. Isolated ' +
        'from traffic_events so it stays outside the visitor/pageview Metrics Contract.',
    target: 'clickhouse',
    dependencies: [],

    async up(context: IMigrationContext): Promise<void> {
        if (!context.clickhouse) {
            console.log('[Migration 018] ClickHouse not configured — skipping redirect_events table creation');
            return;
        }

        await context.clickhouse.exec(`
            CREATE TABLE IF NOT EXISTS redirect_events (
                timestamp DateTime64(3, 'UTC'),
                pattern LowCardinality(String),
                path String,
                destination LowCardinality(String),
                permanent UInt8,
                bot_class LowCardinality(String),
                country LowCardinality(String) DEFAULT ''
            )
            ENGINE = MergeTree()
            PARTITION BY toYYYYMM(timestamp)
            ORDER BY (timestamp, pattern)
            TTL toDateTime(timestamp) + INTERVAL 18 MONTH DELETE
        `);

        console.log('[Migration 018] Created ClickHouse redirect_events table (18-month TTL)');
    }
};
