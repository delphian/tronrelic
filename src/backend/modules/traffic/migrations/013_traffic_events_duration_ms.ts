import type { IMigration, IMigrationContext } from '@/types';

/**
 * Add `duration_ms` to the ClickHouse `traffic_events` table.
 *
 * **Why this migration exists.**
 * Phase A of the Better Auth Phase 6 cutover re-platforms the `/system/users`
 * analytics dashboard off Mongo `users` aggregations onto `traffic_events`.
 * The engagement panel needs per-session duration, which the existing schema
 * cannot carry — `duration_ms` is the additive column that backs the
 * average-duration, pages-per-session, and bounce-rate metrics.
 *
 * **Extended event_type enum.** The same re-platform widens the categorical
 * `event_type` column (still `LowCardinality(String)`, so no schema change is
 * required to add values) to:
 *   - `'bootstrap'`      — cookie minted, no Mongo write (pre-existing)
 *   - `'session_start'`  — cookie-validated session begins (pre-existing)
 *   - `'session_end'`    — session closed; carries `duration_ms`
 *   - `'page'`           — page view within a session; uses `path`
 *
 * `session_end` and `page` rows begin landing only once Phase D wires the
 * session-event emission surface; until then the engagement panel reads empty.
 *
 * **Idempotent.** `ADD COLUMN IF NOT EXISTS` is a no-op on re-run. `duration_ms`
 * sits outside the table's `ORDER BY (timestamp, candidate_uid)` key, so adding
 * it is a pure metadata operation with no data rewrite.
 *
 * **Skip behavior.** Skipped with a warning when `CLICKHOUSE_HOST` is unset,
 * matching migrations 010/012 and `TrafficService`'s no-op posture.
 *
 * **Rollback.**
 * ```sql
 * ALTER TABLE traffic_events DROP COLUMN duration_ms;
 * ```
 * Forward-only by project convention.
 */
export const migration: IMigration = {
    id: '013_traffic_events_duration_ms',
    description:
        'Add Nullable(UInt32) duration_ms column to the ClickHouse traffic_events table for ' +
        'the Phase A engagement panel (populated on session_end events). Additive (sits outside ' +
        'the ORDER BY key); documents the session_end / page event_type additions.',
    target: 'clickhouse',
    dependencies: ['module:traffic:010_create_traffic_events_table'],

    async up(context: IMigrationContext): Promise<void> {
        if (!context.clickhouse) {
            console.log('[Migration 013] ClickHouse not configured — skipping traffic_events duration_ms add');
            return;
        }

        await context.clickhouse.exec(`
            ALTER TABLE traffic_events
                ADD COLUMN IF NOT EXISTS duration_ms Nullable(UInt32) AFTER referral_code
        `);

        console.log('[Migration 013] Added traffic_events.duration_ms');
    }
};
