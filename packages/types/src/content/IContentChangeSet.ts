/**
 * @file IContentChangeSet.ts
 *
 * What differs between the version of an item a reviewer is asked to approve
 * and the version visitors see now. A curator approving an edit approves every
 * difference, so showing only the full new text makes them hunt for the change
 * by memory. This shape lists each changed field with the change marked,
 * names the fields that did not change, and says when there is nothing live to
 * compare against.
 *
 * It is computed on the server and sent as plain data rather than HTML, so a
 * renderer places the text as text and content written by a non-curator can
 * never inject markup into the admin page.
 */

import type { ContentFieldChange } from './ContentFieldChange.js';

/**
 * The difference between an item's live version and the version under review.
 */
export interface IContentChangeSet {
    /**
     * What the version under review was compared against. `approved` — the
     * version a curator last approved, which visitors see now. `none` — the
     * item has never been approved, so nothing is live and `changes` is empty;
     * the whole item is new and the reviewer reads it in full instead.
     */
    baseline: 'approved' | 'none';

    /** Each changed field, in the order the content type lists its reviewed fields. */
    changes: ContentFieldChange[];

    /** Labels of the compared fields that did not change, so a reviewer knows they were checked. */
    unchangedFields: string[];
}
