/**
 * @fileoverview What the curation history is asked for: one page of decided
 * items, optionally narrowed to one decision and one content type.
 */

import type { CurationDecision } from './CurationDecision.js';

/**
 * Paging and filters for the curation history.
 *
 * Decided items are kept forever as the audit trail, so the history grows
 * without bound. The admin page reads it one page at a time, and finds a
 * group of decisions, such as rejected tweets, by filtering rather than by
 * scrolling.
 */
export interface ICurationHistoryListOptions {
    /** Most items to return. The caller bounds it; the admin route allows 1 to 100. */
    limit: number;

    /** Items to skip, newest decision first, so a caller can reach any page. */
    skip: number;

    /** Only items closed with this status. Omit it to list every decision. */
    decision?: CurationDecision;

    /**
     * Only items of this content type, matched exactly, such as
     * `x-poster:tweet`. Omit it to list every type.
     */
    typeId?: string;
}
