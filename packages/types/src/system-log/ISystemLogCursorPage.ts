/**
 * @fileoverview One page of a cursor-paged system log query.
 */

import type { ISystemLogCursor } from './ISystemLogCursor.js';

/**
 * A page of log entries, newest first, plus the cursor for the page after it.
 *
 * There is deliberately no total count. Counting every matching entry on each
 * request costs a scan over up to the whole collection, and a caller walking
 * by cursor only needs to know whether more entries exist.
 */
export interface ISystemLogCursorPage {
    /**
     * Log entries for this page, newest first.
     */
    logs: any[];

    /**
     * Cursor to pass as `before` for the next page, or `null` when this page
     * holds the last matching entries.
     */
    next: ISystemLogCursor | null;
}
