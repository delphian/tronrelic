/**
 * @fileoverview The resource limits ClickHouse enforces on one account.
 *
 * A ClickHouse account here is a ClickHouse user together with the settings
 * profile and quota attached to it. The limits live on the server rather than
 * in application code, so a bug in a caller cannot run a query the account's
 * limits forbid. The same shape carries three different things: the limits an
 * account starts with, the ceiling an admin may not raise them above, and the
 * values currently in force.
 */

/**
 * Per-query and per-hour limits applied to one ClickHouse account.
 *
 * The per-query fields become settings in the account's settings profile, each
 * written with a `MAX` constraint so a caller can lower the value for one query
 * but never raise it. The hourly fields become the account's quota.
 */
export interface IClickHouseAccountLimits {
    /** Longest a single query may run, in seconds (`max_execution_time`). */
    maxExecutionSeconds: number;

    /**
     * Most rows a single query may read from tables (`max_rows_to_read`). This
     * is the main defence against a query that scans a whole table.
     */
    maxRowsToRead: number;

    /** Most uncompressed bytes a single query may read (`max_bytes_to_read`). */
    maxBytesToRead: number;

    /** Most memory a single query may use, in bytes (`max_memory_usage`). */
    maxMemoryBytes: number;

    /**
     * Most threads a single query may use (`max_threads`). Keeping this low
     * leaves CPU for the chain writer and the rest of the application.
     */
    maxThreads: number;

    /** Most rows a single query may return (`max_result_rows`). */
    maxResultRows: number;

    /**
     * Most queries the account may run at the same moment
     * (`max_concurrent_queries_for_user`). Stops parallel callers piling up.
     */
    maxConcurrentQueries: number;

    /** Most queries per quota key per hour (quota `queries`). */
    hourlyQueries: number;

    /** Most rows read per quota key per hour (quota `read_rows`). */
    hourlyReadRows: number;

    /** Most total execution time per quota key per hour, in seconds (quota `execution_time`). */
    hourlyExecutionSeconds: number;
}
