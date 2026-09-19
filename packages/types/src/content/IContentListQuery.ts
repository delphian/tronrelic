/**
 * @file IContentListQuery.ts
 *
 * The filter a caller passes when it asks core which items of a type match a
 * review state or deletion state. Review state lives only in core's own
 * collection, so a content author that needs "every pending page" or "every
 * deleted page" asks core for the ids first and then loads those records.
 */

import type { ContentCurationState } from './ContentCurationState.js';

/**
 * Filter for `IContentService.list` and `IContentService.count`.
 */
export interface IContentListQuery {
    /** The content type to list. */
    typeId: string;

    /**
     * Restrict to one review state. `'none'` matches items that have never
     * entered review. Omit to match every state.
     */
    curation?: ContentCurationState | 'none';

    /**
     * `false` (the default) lists live items only, `true` lists soft-deleted
     * items only.
     */
    deleted?: boolean;

    /** Maximum rows to return. Defaults to 50 and is capped at 500. */
    limit?: number;

    /** Rows to skip, for paging. Defaults to 0. */
    skip?: number;
}
