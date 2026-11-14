/**
 * @fileoverview Creates the ClickHouse `mcp_calls` table, one row per MCP tool
 * call, which the usage view on `/system/mcp` totals by group, tool, and caller.
 */

import type { IMigration, IMigrationContext } from '@/types';

/**
 * Create the `mcp_calls` table.
 *
 * **Why this migration exists.** Opening an MCP endpoint to anonymous callers
 * needs accounting an admin can read at a glance: how many calls each group's
 * callers made, how many were refused by a limit, and who is pushing hardest.
 * The MongoDB audit trail holds one detailed record per call for forensics,
 * but totalling it by group, tool, and caller over 30 days of public traffic is
 * the wrong job for it. ClickHouse already holds the platform's other
 * high-volume event data (`traffic_events`), so the totals live there.
 *
 * **Schema.**
 *   - `timestamp` — when the call was recorded, `DateTime64(3, 'UTC')` like
 *     `traffic_events`, so the same UTC format helper writes it.
 *   - `endpoint` — `oauth` for `/mcp`, `public` for `/mcp/public`.
 *   - `principal_kind`, `principal_id` — `user` with a Better Auth user id, or
 *     `anonymous` with the salted hash of the caller's network range. No raw
 *     address is ever stored. An `api-key` kind can be added later with no
 *     schema change.
 *   - `charged_group` — the user group whose limits applied.
 *   - `tool` — the tool called.
 *   - `outcome` — `succeeded`, `refused`, or `failed`; `status` keeps the
 *     governor's own status, or `not-served` for a tool the caller was not
 *     offered; `limit_hit` names the limit that refused the call, when one did;
 *     `reason` says why a tool was not served.
 *   - `duration_ms`, `cost_usd` — run time and recorded cost.
 *   - `client_id`, `client_name` — the OAuth client and the self-reported
 *     `User-Agent`, both labels for grouping only.
 *   - `record_id` — the MongoDB audit record's id, empty for a `not-served` row.
 *
 * Ordered by `(charged_group, timestamp)` because every usage query filters by
 * time and most also by group. Partitioned by month, and rows expire after
 * 13 months so a year-on-year comparison stays possible.
 *
 * **Idempotent.** `CREATE TABLE IF NOT EXISTS` is a no-op on later runs.
 *
 * **Skip behavior.** Without ClickHouse the runner skips this migration with
 * a warning. The meter then writes nothing and the usage view says ClickHouse
 * is not configured.
 *
 * **Rollback.** `DROP TABLE IF EXISTS mcp_calls;` Forward-only by convention.
 */
export const migration: IMigration = {
    id: '002_create_mcp_calls_table',
    description:
        'Create the ClickHouse mcp_calls MergeTree table (13-month TTL, ordered by (charged_group, timestamp)) ' +
        'holding one row per MCP tool call, so /system/mcp can total usage by group, tool, and caller.',
    target: 'clickhouse',
    dependencies: [],

    async up(context: IMigrationContext): Promise<void> {
        if (!context.clickhouse) {
            console.log('[Migration module:mcp:002] ClickHouse not configured — skipping mcp_calls table creation');
            return;
        }

        await context.clickhouse.exec(`
            CREATE TABLE IF NOT EXISTS mcp_calls (
                timestamp DateTime64(3, 'UTC'),
                endpoint LowCardinality(String),
                principal_kind LowCardinality(String),
                principal_id String,
                charged_group LowCardinality(String),
                tool LowCardinality(String),
                outcome LowCardinality(String),
                status LowCardinality(String),
                limit_hit LowCardinality(String) DEFAULT '',
                reason LowCardinality(String) DEFAULT '',
                duration_ms UInt32,
                cost_usd Float64,
                client_id String DEFAULT '',
                client_name String DEFAULT '',
                record_id String DEFAULT ''
            )
            ENGINE = MergeTree()
            PARTITION BY toYYYYMM(timestamp)
            ORDER BY (charged_group, timestamp)
            TTL toDateTime(timestamp) + INTERVAL 13 MONTH
        `);
    }
};
