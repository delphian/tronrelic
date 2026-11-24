/**
 * @fileoverview ClickHouse DDL for `traffic_goal_events`, one row per goal a
 * visitor reached.
 *
 * Why it exists: a goal, such as following a link to a rental market, has to
 * be attributed to the visitor and session it came from with the same rules as
 * every other traffic figure. Before this table the only record of such clicks
 * was a per-market total in the plugin that owned the link, with nothing tying
 * a click to a visitor.
 *
 * Why a sibling table, not a new `event_type` in `traffic_events`: about
 * eighteen reads of `traffic_events` define visitors, pageviews, sessions, and
 * crawler counts, several of them over every row regardless of `event_type`.
 * A goal row there would change what those figures mean. Goals are joined to
 * the page sessions at read time instead.
 */

import type { IMigration, IMigrationContext } from '@/types';

/**
 * Creates `traffic_goal_events`.
 *
 * Ordered by `(timestamp, candidate_uid)` like `traffic_events`, so a windowed
 * read prunes on the leading key and the ignore list's literal
 * `candidate_uid NOT IN (…)` stays index-friendly. A visitor without analytics
 * consent is stored under the all-zero UUID with no account id and no address
 * hashes, so `candidate_uid` never needs to be nullable in the sort key.
 * Same 18-month TTL as `traffic_events`.
 *
 * Idempotent through `CREATE TABLE IF NOT EXISTS`. Rollback, if ever needed:
 * `DROP TABLE IF EXISTS traffic_goal_events`.
 */
export const migration: IMigration = {
    id: '024_create_traffic_goal_events_table',
    description:
        'Create the ClickHouse traffic_goal_events table (18-month TTL, ordered by (timestamp, candidate_uid)), ' +
        'one row per goal a visitor reached, reported by components through the traffic-goals service. Kept apart ' +
        'from traffic_events so no visitor or pageview figure changes meaning. Until it runs, goals are not stored ' +
        'and the Goals tab and goal AI reads come back empty.',
    target: 'clickhouse',
    dependencies: [],

    /**
     * Apply the DDL.
     *
     * @param context - Migration context; `clickhouse` is undefined when the
     *   deployment has no ClickHouse, in which case there is nothing to create.
     */
    async up(context: IMigrationContext): Promise<void> {
        if (!context.clickhouse) {
            return;
        }

        await context.clickhouse.exec(`
            CREATE TABLE IF NOT EXISTS traffic_goal_events (
                timestamp DateTime64(3, 'UTC'),
                candidate_uid UUID,
                user_id Nullable(String),
                goal LowCardinality(String),
                properties Map(LowCardinality(String), String),
                path String DEFAULT '',
                analytics_consent UInt8,
                bot_class LowCardinality(Nullable(String)),
                bot_rule LowCardinality(Nullable(String)),
                country LowCardinality(Nullable(String)),
                device LowCardinality(String) DEFAULT 'unknown',
                asn Nullable(UInt32),
                ip_hash Nullable(String),
                subnet_hash Nullable(String),

                INDEX idx_goal goal TYPE set(100) GRANULARITY 4
            )
            ENGINE = MergeTree()
            PARTITION BY toYYYYMM(timestamp)
            ORDER BY (timestamp, candidate_uid)
            TTL toDateTime(timestamp) + INTERVAL 18 MONTH DELETE
        `);
    }
};
