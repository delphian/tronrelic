/**
 * @fileoverview Position marker for walking the system logs page by page.
 *
 * Page-number paging skips a fixed number of rows, so when new entries arrive
 * between two requests every later page shifts and entries repeat or go
 * missing. A cursor instead records where the previous page stopped, so the
 * next page starts exactly after it no matter how many entries were written
 * in between.
 */

/**
 * Where the previous page of logs ended, newest-first order.
 *
 * Log timestamps have millisecond precision and are not unique, so the
 * timestamp alone cannot say where a page stopped when several entries share
 * the boundary millisecond. `seenIds` lists the entries at exactly that
 * timestamp which the previous page already returned, so the next page can
 * return the remaining ones without repeating any.
 */
export interface ISystemLogCursor {
    /**
     * Timestamp of the last entry the previous page returned. The next page
     * only contains entries at or before this time.
     */
    timestamp: Date;

    /**
     * Ids of the entries at exactly `timestamp` that the previous page already
     * returned, including those returned by earlier pages that stopped at the
     * same millisecond. Usually one id.
     */
    seenIds: string[];
}
