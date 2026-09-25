/**
 * @fileoverview Per-query options for a read made through a ClickHouse
 * account.
 */

/**
 * Options that attach accountability and cancellation to one read.
 */
export interface IClickHouseQueryOptions {
    /**
     * Query id to record in ClickHouse's query log. Pass one when something
     * else, such as an AI tool audit record, needs to point at this query.
     * ClickHouse generates one when omitted.
     */
    queryId?: string;

    /**
     * Quota key the hourly budget is counted under, such as an agent run id or
     * an end-user id. Each key gets its own budget. Omit it to count against the
     * account as a whole.
     */
    quotaKey?: string;

    /**
     * Aborts the request when signalled. The account's profile tells ClickHouse
     * to cancel a read-only query whose client disconnects, so aborting here
     * stops the work on the server too.
     */
    signal?: AbortSignal;
}
