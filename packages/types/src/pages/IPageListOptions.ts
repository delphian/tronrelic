/**
 * @fileoverview What the admin page list is asked for: one page of pages,
 * optionally narrowed by status, review state, and search text.
 */

import type { ContentCurationState } from '../content/ContentCurationState.js';

/**
 * Filters and paging for `IPageService.listPages`.
 *
 * `published` and `search` filter the latest edit; `curation` asks core for
 * the pages in one review state; `deleted` switches to the soft-deleted
 * pages. The admin page reads one page at a time, so a growing CMS never
 * draws every page at once.
 */
export interface IPageListOptions {
    /** Only published (`true`) or draft (`false`) pages. Omit it for both. */
    published?: boolean;

    /** Text the page's title, slug, or description must contain, matched by the text index. */
    search?: string;

    /** Only pages whose row in core is in this review state. */
    curation?: ContentCurationState;

    /** List the soft-deleted pages instead of the live ones. */
    deleted?: boolean;

    /** Most pages to return; held to 1–100, default 50. */
    limit?: number;

    /** Pages to skip, newest first, so a caller can reach any page; default 0. */
    skip?: number;
}
