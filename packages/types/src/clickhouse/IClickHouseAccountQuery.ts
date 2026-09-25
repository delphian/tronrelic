/**
 * @fileoverview One query an account ran or is running, as ClickHouse
 * recorded it.
 *
 * Running queries come from `system.processes` and finished ones from
 * `system.query_log`. The same shape serves both so the admin page can show
 * them in one table.
 */

/**
 * A running or finished query owned by an account.
 */
export interface IClickHouseAccountQuery {
    /** ClickHouse query id; the key for stopping a running query. */
    queryId: string;

    /** `running`, `finished`, or `failed`. */
    status: 'running' | 'finished' | 'failed';

    /** When the query started, as an ISO timestamp. */
    startedAt: string;

    /** How long the query ran or has been running, in milliseconds. */
    durationMs: number;

    /** Rows read from tables. */
    readRows: number;

    /** Uncompressed bytes read from tables. */
    readBytes: number;

    /** Rows returned, or 0 while running. */
    resultRows: number;

    /** Peak memory used, in bytes. */
    memoryBytes: number;

    /** ClickHouse error code when the query failed, otherwise null. */
    errorCode: number | null;

    /** First part of the error message when the query failed, otherwise null. */
    error: string | null;

    /** True when the failure was a resource limit or quota, rather than a bad query. */
    hitLimit: boolean;

    /** First part of the SQL text. */
    sql: string;
}
