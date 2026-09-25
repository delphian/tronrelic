/**
 * @fileoverview One day of an account's query activity.
 *
 * ClickHouse keeps its own query log for only a few days, which is too short
 * to answer questions about an account's behaviour over weeks. A scheduled job
 * copies daily totals out of that log into a small table kept for a year, and
 * this is one row of it.
 */

/**
 * Daily totals for one ClickHouse user.
 */
export interface IClickHouseAccountUsageDay {
    /** The UTC day, as `YYYY-MM-DD`. */
    day: string;

    /** Queries that finished or failed that day. */
    queries: number;

    /** Queries that failed for any reason. */
    failed: number;

    /** Failures caused by a resource limit or the quota. */
    limitHits: number;

    /** Failures caused by the account lacking permission or being read-only. */
    denied: number;

    /** Total rows read. */
    readRows: number;

    /** Total uncompressed bytes read. */
    readBytes: number;

    /** Total rows returned. */
    resultRows: number;

    /** Total execution time, in milliseconds. */
    totalDurationMs: number;

    /** Longest single query, in milliseconds. */
    maxDurationMs: number;

    /** Highest memory any single query used, in bytes. */
    maxMemoryBytes: number;
}
