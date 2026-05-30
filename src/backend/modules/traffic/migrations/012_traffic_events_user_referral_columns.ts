import type { IMigration, IMigrationContext } from '@/types';

/**
 * Add `user_id` and `referral_code` columns to the ClickHouse `traffic_events` table.
 *
 * **Why this migration exists.**
 * Phase 5 of the Better Auth refactor re-keys traffic analytics onto the new
 * `tronrelic_tid` cookie (a UUID, so `candidate_uid`'s column type is
 * unchanged) and adds two attribution dimensions that did not exist when
 * migration 010 created the table:
 *   - `user_id` — the Better Auth user id when the event was recorded for a
 *     logged-in visitor. Lets analytics attribute traffic to an account
 *     without retyping the `candidate_uid` sort-key column (which ClickHouse
 *     forbids in place).
 *   - `referral_code` — the first-touch referral code captured from an
 *     inbound `?ref=` (the `tronrelic_ref` cookie). Makes referral landings
 *     visible in traffic analytics and preserves the code for conversion
 *     attribution.
 *
 * Both are `Nullable(String)` because most rows carry neither (anonymous
 * traffic with no referral). They sit outside the table's `ORDER BY`
 * `(timestamp, candidate_uid)` key, so adding them is a pure metadata
 * operation — no data rewrite.
 *
 * **Idempotent.** `ADD COLUMN IF NOT EXISTS` is a no-op on re-run.
 *
 * **Ordering.** Deploy this with the Phase 5 backend: `TrafficService`
 * begins selecting and inserting these columns, so the table must carry
 * them first. Until it runs, `getEventsForUser` reads degrade to `[]`
 * (the service swallows the read error) and inserts of the new columns
 * would be rejected — run it as part of the Phase 5 release.
 *
 * **Skip behavior.** Skipped with a warning when `CLICKHOUSE_HOST` is unset,
 * matching migration 010 and `TrafficService`'s no-op posture.
 *
 * **Rollback.**
 * ```sql
 * ALTER TABLE traffic_events DROP COLUMN referral_code, DROP COLUMN user_id;
 * ```
 * Forward-only by project convention.
 */
export const migration: IMigration = {
    id: '012_traffic_events_user_referral_columns',
    description:
        'Add Nullable(String) user_id and referral_code columns to the ClickHouse ' +
        'traffic_events table for Better Auth Phase 5 account attribution and referral ' +
        'first-touch capture. Additive (columns sit outside the ORDER BY key).',
    target: 'clickhouse',
    dependencies: ['module:traffic:010_create_traffic_events_table'],

    async up(context: IMigrationContext): Promise<void> {
        if (!context.clickhouse) {
            console.log('[Migration 012] ClickHouse not configured — skipping traffic_events column add');
            return;
        }

        await context.clickhouse.exec(`
            ALTER TABLE traffic_events
                ADD COLUMN IF NOT EXISTS user_id Nullable(String) AFTER candidate_uid,
                ADD COLUMN IF NOT EXISTS referral_code LowCardinality(Nullable(String)) AFTER user_id
        `);

        console.log('[Migration 012] Added traffic_events.user_id and traffic_events.referral_code');
    }
};
