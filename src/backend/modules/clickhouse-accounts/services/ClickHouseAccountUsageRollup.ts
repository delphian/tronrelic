/**
 * @fileoverview Copies daily per-user query totals out of ClickHouse's query
 * log into a small table kept for a year.
 *
 * ClickHouse keeps `system.query_log` for only three days on this deployment
 * (`configs/clickhouse/system-logs-ttl.xml`), which is too short to answer
 * "how has the agent's usage changed this month". Keeping the raw log longer
 * would cost a lot of disk, so instead a scheduled job sums each day into one
 * row per ClickHouse user, and the admin page reads the history from there.
 */

import type { IClickHouseAccountUsageDay, IClickHouseService } from '@/types';
import { DENIED_ERROR_CODES, LIMIT_ERROR_CODES } from './limitErrorCodes.js';

/** Table in the application database holding the daily totals. */
export const USAGE_TABLE = 'clickhouse_account_usage_daily';

/** How long daily totals are kept. */
const RETENTION_DAYS = 365;

/**
 * How many days back each rollup recomputes, today included. Three covers the
 * whole query log, so a day the job missed, such as during an outage, is
 * filled in by the next run as long as it happens within the log's retention.
 */
const ROLLUP_WINDOW_DAYS = 3;

/** Row shape of the history read. ClickHouse quotes 64-bit integers. */
interface IUsageRow {
    day_text: string;
    queries: string;
    failed: string;
    limit_hits: string;
    denied: string;
    read_rows: string;
    read_bytes: string;
    result_rows: string;
    total_duration_ms: string;
    max_duration_ms: string;
    max_memory_bytes: string;
}

/**
 * Maintains and reads the daily usage table.
 */
export class ClickHouseAccountUsageRollup {
    /**
     * @param clickhouse - The shared connection, which can read every user's
     *   rows in `system.query_log` and write to the application database.
     */
    constructor(private readonly clickhouse: IClickHouseService) {}

    /**
     * Create the daily usage table if it does not exist.
     *
     * `ReplacingMergeTree` keyed on `(clickhouse_user, day)` lets each rollup
     * simply insert fresh totals for the recent days: the newest row for a
     * user and day replaces the older ones when parts merge, and reads use
     * `FINAL` to see only that row before a merge happens.
     */
    async ensureTable(): Promise<void> {
        await this.clickhouse.exec(`
            CREATE TABLE IF NOT EXISTS ${USAGE_TABLE} (
                day Date,
                clickhouse_user LowCardinality(String),
                queries UInt64,
                failed UInt64,
                limit_hits UInt64,
                denied UInt64,
                read_rows UInt64,
                read_bytes UInt64,
                result_rows UInt64,
                total_duration_ms UInt64,
                max_duration_ms UInt64,
                max_memory_bytes UInt64,
                computed_at DateTime64(3, 'UTC')
            )
            ENGINE = ReplacingMergeTree(computed_at)
            ORDER BY (clickhouse_user, day)
            TTL day + INTERVAL ${RETENTION_DAYS} DAY
        `);
    }

    /**
     * Recompute the totals for the last few days for every ClickHouse user.
     *
     * Every user is rolled up, not only declared accounts, so an account added
     * later already has history, and a user someone created by hand is still
     * accounted for. The work runs entirely inside ClickHouse as one
     * `INSERT ... SELECT`, so no rows cross the network.
     */
    async rollup(): Promise<void> {
        await this.clickhouse.exec(`
            INSERT INTO ${USAGE_TABLE}
            SELECT
                event_date AS day,
                user AS clickhouse_user,
                count() AS queries,
                countIf(type != 'QueryFinish') AS failed,
                countIf(exception_code IN (${LIMIT_ERROR_CODES.join(', ')})) AS limit_hits,
                countIf(exception_code IN (${DENIED_ERROR_CODES.join(', ')})) AS denied,
                sum(read_rows) AS read_rows,
                sum(read_bytes) AS read_bytes,
                sum(result_rows) AS result_rows,
                sum(query_duration_ms) AS total_duration_ms,
                max(query_duration_ms) AS max_duration_ms,
                max(memory_usage) AS max_memory_bytes,
                now64(3) AS computed_at
            FROM system.query_log
            WHERE event_date >= today() - ${ROLLUP_WINDOW_DAYS - 1}
              AND type != 'QueryStart'
            GROUP BY day, clickhouse_user
        `);
    }

    /**
     * Read one user's daily totals.
     *
     * @param user - ClickHouse user name.
     * @param days - How many days back to include, today included.
     * @returns Oldest day first. Days with no queries are absent.
     */
    async history(user: string, days: number): Promise<IClickHouseAccountUsageDay[]> {
        // The text form of the day gets its own alias. Naming it `day` would
        // shadow the Date column in the WHERE clause below, and ClickHouse
        // would then compare a String with a Date and refuse the query.
        const rows = await this.clickhouse.query<IUsageRow>(
            `SELECT toString(day) AS day_text, queries, failed, limit_hits, denied, read_rows, read_bytes,
                    result_rows, total_duration_ms, max_duration_ms, max_memory_bytes
             FROM ${USAGE_TABLE} FINAL
             WHERE clickhouse_user = {user:String} AND day >= today() - {back:UInt32}
             ORDER BY day`,
            { user, back: Math.max(0, days - 1) }
        );

        return rows.map(row => ({
            day: row.day_text,
            queries: Number(row.queries),
            failed: Number(row.failed),
            limitHits: Number(row.limit_hits),
            denied: Number(row.denied),
            readRows: Number(row.read_rows),
            readBytes: Number(row.read_bytes),
            resultRows: Number(row.result_rows),
            totalDurationMs: Number(row.total_duration_ms),
            maxDurationMs: Number(row.max_duration_ms),
            maxMemoryBytes: Number(row.max_memory_bytes)
        }));
    }
}
