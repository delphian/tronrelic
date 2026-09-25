/**
 * @fileoverview How much of its hourly quota one quota key has used.
 *
 * An account's quota is tracked per quota key: a caller can pass a key per
 * agent run or per end user, and each key gets its own hourly budget. A call
 * that passes no key is tracked under the account's user name instead.
 */

/**
 * One row of `system.quotas_usage` for an account's quota.
 */
export interface IClickHouseAccountQuotaUsage {
    /** The quota key, or the user name for calls that passed no key. */
    quotaKey: string;

    /** When the current hourly interval ends and the counters reset, as an ISO timestamp. */
    intervalEndsAt: string | null;

    /** Queries run in the current interval. */
    queries: number;

    /** Query limit for the interval, or null when unlimited. */
    maxQueries: number | null;

    /** Rows read in the current interval. */
    readRows: number;

    /** Row limit for the interval, or null when unlimited. */
    maxReadRows: number | null;

    /** Execution time used in the current interval, in seconds. */
    executionSeconds: number;

    /** Execution time limit for the interval in seconds, or null when unlimited. */
    maxExecutionSeconds: number | null;
}
