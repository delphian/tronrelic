/**
 * @fileoverview Filters and position for a cursor-paged system log query.
 */

import type { ISystemLogQuery } from './ISystemLogService.js';
import type { ISystemLogCursor } from './ISystemLogCursor.js';

/**
 * Query options for reading the system logs one page at a time by cursor.
 *
 * Takes the same filters as a page-number query, minus `page`. To read the
 * next page, repeat the same filters and pass the `next` cursor the previous
 * page returned as `before`. Changing the filters between pages is allowed
 * but walks a different result set from that point on.
 */
export interface ISystemLogCursorQuery extends Omit<ISystemLogQuery, 'page'> {
    /**
     * Where the previous page ended. Omit to start from the newest entry.
     */
    before?: ISystemLogCursor;
}
