/**
 * @file IContentListChangeItem.ts
 *
 * One entry of a compared list field, such as a single tag or keyword.
 */

import type { ContentDiffOp } from './ContentDiffOp.js';

/**
 * A list entry and whether it was kept, added, or removed.
 */
export interface IContentListChangeItem {
    /** Whether the entry is in both versions, only the new one, or only the old one. */
    op: ContentDiffOp;

    /** The entry, as plain text. */
    value: string;
}
