/**
 * @fileoverview Reads what ClickHouse itself reports about an account: its
 * settings, grants, quota usage, and queries.
 *
 * The admin page shows server-reported state rather than the platform's own
 * record of what it applied, so an account someone changed by hand on the
 * server shows up as a difference instead of being hidden. Every read here
 * goes through the shared connection, which is the only one allowed to read
 * other users' rows in ClickHouse's system tables.
 */

import type {
    IClickHouseAccountGrant,
    IClickHouseAccountQuery,
    IClickHouseAccountQuotaUsage,
    IClickHouseAccountSetting,
    IClickHouseService
} from '@/types';
import { ClickHouseAccountError } from './ClickHouseAccountError.js';
import { LIMIT_ERROR_CODES } from './limitErrorCodes.js';

/**
 * A ClickHouse query id this module will write into a `KILL QUERY` statement.
 * ClickHouse generates UUIDs, and callers that choose their own use simple
 * tokens, so anything outside this set is refused rather than escaped.
 */
const QUERY_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

/** Row shape of the running-query read. ClickHouse quotes 64-bit integers. */
interface IProcessRow {
    query_id: string;
    elapsed: number;
    read_rows: string;
    read_bytes: string;
    memory_usage: string;
    sql: string;
}

/** Row shape of the recent-query read. */
interface IQueryLogRow {
    query_id: string;
    type: string;
    started_ms: string;
    query_duration_ms: string;
    read_rows: string;
    read_bytes: string;
    result_rows: string;
    memory_usage: string;
    exception_code: number;
    exception: string;
    sql: string;
}

/** Row shape of the quota usage read. */
interface IQuotaUsageRow {
    quota_key: string;
    ends_ms: string | null;
    queries: string | null;
    max_queries: string | null;
    read_rows: string | null;
    max_read_rows: string | null;
    execution_time: number | null;
    max_execution_time: number | null;
}

/**
 * Server-side introspection for ClickHouse accounts.
 */
export class ClickHouseAccountInspector {
    /**
     * @param clickhouse - The shared connection, which authenticates as the
     *   root user and can read every user's rows in the system tables.
     */
    constructor(private readonly clickhouse: IClickHouseService) {}

    /**
     * Read a settings profile's rows as ClickHouse holds them.
     *
     * @param profile - Settings profile name.
     * @returns One row per setting, in profile order.
     */
    async effectiveSettings(profile: string): Promise<IClickHouseAccountSetting[]> {
        const rows = await this.clickhouse.query<{ name: string; value: string | null; min: string | null; max: string | null }>(
            `SELECT setting_name AS name, value, min, max
             FROM system.settings_profile_elements
             WHERE profile_name = {profile:String} AND isNotNull(setting_name)
             ORDER BY index`,
            { profile }
        );

        return rows.map(row => ({ name: row.name, value: row.value, min: row.min, max: row.max }));
    }

    /**
     * Read the privileges ClickHouse holds for a user.
     *
     * @param user - ClickHouse user name.
     * @returns One row per granted privilege.
     */
    async effectiveGrants(user: string): Promise<IClickHouseAccountGrant[]> {
        const rows = await this.clickhouse.query<{ access_type: string; database: string | null; table: string | null }>(
            `SELECT toString(access_type) AS access_type, database, table
             FROM system.grants
             WHERE user_name = {user:String}
             ORDER BY access_type, database, table`,
            { user }
        );

        return rows.map(row => ({ accessType: row.access_type, database: row.database, table: row.table }));
    }

    /**
     * Read the queries a user is running now.
     *
     * This read itself is excluded. It runs as the root user, so without the
     * exclusion the `default` account would always list at least one running
     * query, and its "nothing is running" state could never appear.
     *
     * @param user - ClickHouse user name.
     * @returns Longest-running first.
     */
    async runningQueries(user: string): Promise<IClickHouseAccountQuery[]> {
        const rows = await this.clickhouse.query<IProcessRow>(
            `SELECT query_id, elapsed, read_rows, read_bytes, memory_usage, substring(query, 1, 500) AS sql
             FROM system.processes
             WHERE user = {user:String}
               AND query_id != queryID()
             ORDER BY elapsed DESC`,
            { user }
        );
        const now = Date.now();

        return rows.map(row => ({
            queryId: row.query_id,
            status: 'running' as const,
            startedAt: new Date(now - Math.round(row.elapsed * 1000)).toISOString(),
            durationMs: Math.round(row.elapsed * 1000),
            readRows: Number(row.read_rows),
            readBytes: Number(row.read_bytes),
            resultRows: 0,
            memoryBytes: Number(row.memory_usage),
            errorCode: null,
            error: null,
            hitLimit: false,
            sql: row.sql
        }));
    }

    /**
     * Read a user's recently finished queries from ClickHouse's query log.
     *
     * The query log keeps only a few days (see
     * `configs/clickhouse/system-logs-ttl.xml`), so this answers "what happened
     * recently". The daily rollup answers questions over a longer period.
     *
     * @param user - ClickHouse user name.
     * @param limit - Most rows to return.
     * @returns Newest first.
     */
    async recentQueries(user: string, limit: number): Promise<IClickHouseAccountQuery[]> {
        const rows = await this.clickhouse.query<IQueryLogRow>(
            `SELECT query_id, toString(type) AS type,
                    toUnixTimestamp64Milli(query_start_time_microseconds) AS started_ms,
                    query_duration_ms, read_rows, read_bytes, result_rows, memory_usage,
                    exception_code, substring(exception, 1, 300) AS exception,
                    substring(query, 1, 500) AS sql
             FROM system.query_log
             WHERE user = {user:String}
               AND event_date >= today() - 3
               AND type != 'QueryStart'
             ORDER BY event_time_microseconds DESC
             LIMIT {limit:UInt32}`,
            { user, limit }
        );

        return rows.map(row => {
            const failed = row.type !== 'QueryFinish';
            return {
                queryId: row.query_id,
                status: failed ? 'failed' as const : 'finished' as const,
                startedAt: new Date(Number(row.started_ms)).toISOString(),
                durationMs: Number(row.query_duration_ms),
                readRows: Number(row.read_rows),
                readBytes: Number(row.read_bytes),
                resultRows: Number(row.result_rows),
                memoryBytes: Number(row.memory_usage),
                errorCode: failed ? row.exception_code : null,
                error: failed ? row.exception : null,
                hitLimit: failed && LIMIT_ERROR_CODES.includes(row.exception_code),
                sql: row.sql
            };
        });
    }

    /**
     * Read how much of its hourly quota each key has used.
     *
     * @param quota - Quota name.
     * @returns One row per key with usage in the current interval.
     */
    async quotaUsage(quota: string): Promise<IClickHouseAccountQuotaUsage[]> {
        const rows = await this.clickhouse.query<IQuotaUsageRow>(
            `SELECT quota_key, toUnixTimestamp(end_time) * 1000 AS ends_ms,
                    queries, max_queries, read_rows, max_read_rows,
                    execution_time, max_execution_time
             FROM system.quotas_usage
             WHERE quota_name = {quota:String}
             ORDER BY quota_key`,
            { quota }
        );

        return rows.map(row => ({
            quotaKey: row.quota_key,
            intervalEndsAt: row.ends_ms === null ? null : new Date(Number(row.ends_ms)).toISOString(),
            queries: Number(row.queries ?? 0),
            maxQueries: row.max_queries === null ? null : Number(row.max_queries),
            readRows: Number(row.read_rows ?? 0),
            maxReadRows: row.max_read_rows === null ? null : Number(row.max_read_rows),
            executionSeconds: row.execution_time ?? 0,
            maxExecutionSeconds: row.max_execution_time
        }));
    }

    /**
     * Stop one of a user's running queries.
     *
     * The query is looked up first, filtered by user, so a query id belonging
     * to another account is never stopped even if it is guessed. The kill is
     * asynchronous, because waiting for a large query to unwind would hold the
     * admin's request open.
     *
     * @param user - ClickHouse user that must own the query. Must be a
     *   validated identifier, because it is written into the statement.
     * @param queryId - The running query's id.
     * @returns True when the query was running under that user and the kill
     *   was sent; false when no such query was running.
     * @throws ClickHouseAccountError (400) when the query id is not a safe token.
     */
    async killQuery(user: string, queryId: string): Promise<boolean> {
        if (!QUERY_ID_PATTERN.test(queryId)) {
            throw new ClickHouseAccountError('Query id may contain only letters, digits, and _ . : -', 400);
        }
        const running = await this.clickhouse.query<{ n: string }>(
            'SELECT count() AS n FROM system.processes WHERE user = {user:String} AND query_id = {queryId:String}',
            { user, queryId }
        );
        const found = Number(running[0]?.n ?? 0) > 0;
        if (found) {
            await this.clickhouse.exec(`KILL QUERY WHERE query_id = '${queryId}' AND user = '${user}' ASYNC`);
        }

        return found;
    }
}
