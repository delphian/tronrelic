import type { IMigration, IMigrationContext } from '@/types';

/**
 * Create the ClickHouse `traffic_events` table that backs the cookieless-traffic split.
 *
 * **Why this migration exists.**
 * Commit `1fccdbe` ("Add signature-based wallet challenge auth and identity cookies",
 * 2026-04-27) moved identity-cookie minting from client JavaScript into a Next.js
 * middleware → backend bootstrap path. The change was correct for security and SSR
 * but accidentally removed the implicit JS-runtime filter that previously kept bots
 * out of the `users` collection. Every cookieless GET — search-engine crawlers,
 * link unfurlers, uptime probes — now persists an empty Mongo row with no country,
 * landing page, device, or referrer. We *want* to track that traffic, just not in
 * the identity collection. ClickHouse is already wired up as an optional module
 * (`src/backend/modules/clickhouse/`) and is the right tool for high-volume
 * append-only event data with rich dimensions.
 *
 * **What this migration does.**
 *   1. Creates table `traffic_events` keyed by `(timestamp, candidate_uid)` so admin
 *      time-range scans hit a contiguous prefix of the primary key.
 *   2. Adds a bloom-filter skip index on `candidate_uid` so the Phase 3 first-touch
 *      backfill ("earliest pre-hydration event for this UUID") doesn't pay a full
 *      partition scan despite the time-first ordering.
 *   3. Sets an 18-month TTL aligned with the project's traffic-log retention posture.
 *      Rows expire automatically — no application-side pruning required.
 *
 * **Schema.**
 *   - `event_type` — `'bootstrap'` (cookie minted, no Mongo write) or
 *     `'session_start'` (cookie-validated session begins). Future event types may be
 *     added without schema change. `LowCardinality(String)` because the cardinality
 *     is bounded.
 *   - `candidate_uid` — the cookie UUID minted by the bootstrap controller. Always
 *     present; `''` only for events emitted before a cookie can be assigned (none
 *     today).
 *   - `path` / `referer` / `original_referrer` — request URL plus the two distinct
 *     referrers we want to keep separate: `Referer` HTTP header (server-visible,
 *     reliable) and `document.referrer` reported by the client (subject to client
 *     scrubbing but covers same-origin nuance).
 *   - `country` — geo-derived from the request IP at write time; the IP itself is
 *     intentionally **not** stored, satisfying the no-PII constraint in
 *     `PLAN-traffic-events.md`.
 *   - `device`, `bot_class` — derived dimensions. `bot_class` is `Nullable` because
 *     non-bot traffic carries no classification.
 *   - `utm_*` — five canonical UTM fields plus the high-cardinality `term` and
 *     `content` (kept as plain `Nullable(String)` rather than `LowCardinality`).
 *   - `sec_ch_ua_*` / `sec_fetch_*` — Client Hints + Fetch Metadata headers
 *     forwarded by the middleware. Useful for distinguishing same-origin
 *     navigations from cross-origin link clicks even when the browser strips
 *     `Referer`.
 *
 * **Idempotent.** `CREATE TABLE IF NOT EXISTS` is a no-op on subsequent runs.
 *
 * **Skip behavior.** If `CLICKHOUSE_HOST` is not configured the migration runner
 * skips this migration with a warning. The user module's `TrafficService`
 * already gracefully no-ops when ClickHouse is unavailable, so a deploy without
 * ClickHouse simply means "no traffic events recorded" — the orphan-row bug
 * fix in later phases stays intact.
 *
 * **Rollback.**
 * ```sql
 * DROP TABLE IF EXISTS traffic_events;
 * ```
 * Forward-only by project convention; rollback only relevant if a schema change
 * is needed before any Phase 1-3 code ships.
 */
export const migration: IMigration = {
    id: '010_create_traffic_events_table',
    description:
        'Create ClickHouse traffic_events MergeTree table (18-month TTL, ordered by ' +
        '(timestamp, candidate_uid) with a bloom-filter skip index on candidate_uid) to ' +
        'capture cookieless and pre-session HTTP traffic without polluting the Mongo ' +
        'users collection. Backs the traffic-events split in PLAN-traffic-events.md.',
    target: 'clickhouse',
    dependencies: [],

    async up(context: IMigrationContext): Promise<void> {
        if (!context.clickhouse) {
            console.log('[Migration 010] ClickHouse not configured — skipping traffic_events table creation');
            return;
        }

        await context.clickhouse.exec(`
            CREATE TABLE IF NOT EXISTS traffic_events (
                event_type LowCardinality(String),
                timestamp DateTime64(3),
                candidate_uid String,

                path String,
                referer Nullable(String),
                original_referrer Nullable(String),

                user_agent Nullable(String),
                accept_language Nullable(String),

                country LowCardinality(Nullable(String)),
                device LowCardinality(String) DEFAULT 'unknown',
                bot_class LowCardinality(Nullable(String)),

                utm_source LowCardinality(Nullable(String)),
                utm_medium LowCardinality(Nullable(String)),
                utm_campaign LowCardinality(Nullable(String)),
                utm_term Nullable(String),
                utm_content Nullable(String),

                sec_ch_ua Nullable(String),
                sec_ch_ua_mobile Nullable(UInt8),
                sec_ch_ua_platform LowCardinality(Nullable(String)),
                sec_fetch_dest LowCardinality(Nullable(String)),
                sec_fetch_mode LowCardinality(Nullable(String)),
                sec_fetch_site LowCardinality(Nullable(String)),

                INDEX idx_candidate_uid candidate_uid TYPE bloom_filter(0.01) GRANULARITY 4
            )
            ENGINE = MergeTree()
            PARTITION BY toYYYYMM(timestamp)
            ORDER BY (timestamp, candidate_uid)
            TTL toDateTime(timestamp) + INTERVAL 18 MONTH DELETE
        `);

        console.log('[Migration 010] Created ClickHouse traffic_events table (18-month TTL)');
    }
};
