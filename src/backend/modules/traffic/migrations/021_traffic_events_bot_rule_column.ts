import type { IMigration, IMigrationContext } from '@/types';

/**
 * Add the bot-rule column to the ClickHouse `traffic_events` table.
 *
 * **Why this migration exists.**
 * Operator bot rules label automated traffic the built-in classifier misses.
 * `bot_rule` records the id of the rule that matched each event, in both
 * `label` and `monitor` mode. That is what lets the Settings tab show how often
 * each rule fires, and lets an operator watch a rule in monitor mode before it
 * changes any figures. NULL means no rule matched.
 *
 * Rows written before this migration carry NULL, the same forward-only rule
 * every other write-time label follows.
 *
 * **Idempotent.** `ADD COLUMN IF NOT EXISTS` is a no-op on re-run. The column
 * sits outside the `ORDER BY` key, so this is a metadata change only.
 *
 * **Skip behavior.** Skipped with a warning when `CLICKHOUSE_HOST` is unset,
 * matching migrations 010–020 and `TrafficService`'s no-op posture.
 *
 * **Deploy order.** The event serializer leaves `bot_rule` out of the insert
 * when it is NULL, so traffic keeps recording before this runs. A row a rule
 * matched would fail to insert, so run this before migration 022 moves the
 * old network list into rules, and before creating rules by hand. "Run all
 * pending" on `/system/database` runs migrations in id order, which does this.
 * 022 does not declare a dependency on this one, because a deployment without
 * ClickHouse skips this migration without recording it as completed, and the
 * dependency would then block 022 forever.
 *
 * **Rollback.**
 * ```sql
 * ALTER TABLE traffic_events DROP COLUMN bot_rule;
 * ```
 * Forward-only by project convention.
 */
export const migration: IMigration = {
    id: '021_traffic_events_bot_rule_column',
    description:
        'Add LowCardinality(Nullable(String)) bot_rule column to the ClickHouse traffic_events table so each ' +
        'event records which operator bot rule matched it, for per-rule match counts and monitor mode.',
    target: 'clickhouse',
    dependencies: [
        'module:traffic:010_create_traffic_events_table',
        // `AFTER source_app` requires the source_app column to exist first.
        'module:traffic:020_traffic_events_source_app_column'
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
            console.log('[Migration 021] ClickHouse not configured — skipping traffic_events bot_rule column add');
            return;
        }

        await context.clickhouse.exec(`
            ALTER TABLE traffic_events
                ADD COLUMN IF NOT EXISTS bot_rule LowCardinality(Nullable(String)) AFTER source_app
        `);

        console.log('[Migration 021] Added traffic_events.bot_rule');
    }
};
