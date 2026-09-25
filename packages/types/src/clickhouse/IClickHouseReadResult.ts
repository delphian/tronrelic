/**
 * @fileoverview The rows of a read made through a ClickHouse account, plus
 * what the read cost.
 *
 * The cost figures come from ClickHouse's own summary of the query, so a
 * caller can keep a running budget, such as rows read per agent run, without
 * a second round trip to the query log.
 */

/**
 * Result rows and cost of one read.
 */
export interface IClickHouseReadResult<T> {
    /** The rows the query returned. */
    rows: T[];

    /** ClickHouse query id, for finding the query in `system.query_log`. */
    queryId: string;

    /** Rows the query read from tables, as ClickHouse reported. */
    readRows: number;

    /** Uncompressed bytes the query read, as ClickHouse reported. */
    readBytes: number;

    /** Wall-clock time of the request as the backend measured it, in milliseconds. */
    elapsedMs: number;
}
