/**
 * @file IContentListChange.ts
 *
 * A change to a field holding a list of short text values, such as tags,
 * keywords, or transaction ids. Each entry is compared whole, because a
 * line-and-word diff of a joined list would split one tag across several
 * marks and hide that it was simply added or removed.
 */

import type { IContentFieldChangeBase } from './IContentFieldChangeBase.js';
import type { IContentListChangeItem } from './IContentListChangeItem.js';

/**
 * The before-and-after of one list field.
 */
export interface IContentListChange extends IContentFieldChangeBase {
    kind: 'list';

    /** Every entry of both versions, in order, each marked kept, added, or removed. */
    items: IContentListChangeItem[];
}
