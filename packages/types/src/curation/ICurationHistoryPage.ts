/**
 * @fileoverview One page of the curation history.
 */

import type { ICurationItem } from './ICurationItem.js';
import type { ICurationHistoryTypeOption } from './ICurationHistoryTypeOption.js';

/**
 * The answer to a curation history request: one page of decided items and
 * enough about the whole history for the admin page to draw its pager and its
 * type filter.
 */
export interface ICurationHistoryPage {
    /** The page of decided items, newest decision first, with live delivery outcomes overlaid. */
    items: ICurationItem[];

    /** Decided items matching the request's filters across every page, for the pager. */
    total: number;

    /**
     * Every content type with at least one decided item, sorted by label,
     * whatever the request's filters. The type filter lists these, so it does
     * not change as the admin narrows the list.
     */
    types: ICurationHistoryTypeOption[];
}
