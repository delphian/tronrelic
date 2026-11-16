/**
 * @file IContentValueChange.ts
 *
 * A change to a field holding one small value, such as a yes-or-no flag, a
 * number, or a single URL, shown as the old value and the new one side by
 * side. Values are formatted as text on the server so every renderer shows
 * them the same way.
 */

import type { IContentFieldChangeBase } from './IContentFieldChangeBase.js';

/**
 * The before-and-after of one scalar field.
 */
export interface IContentValueChange extends IContentFieldChangeBase {
    kind: 'value';

    /** The live value as text, or null when the live version has none. */
    before: string | null;

    /** The value under review as text, or null when it was cleared. */
    after: string | null;
}
