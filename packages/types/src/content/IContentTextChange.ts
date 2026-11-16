/**
 * @file IContentTextChange.ts
 *
 * A change to a text field, such as a title or a Markdown body, shown line by
 * line with the changed words marked inside each changed line. Markdown is
 * compared as its source text rather than as rendered HTML, so a change to a
 * link target or a heading level is visible even when the rendered page would
 * look almost the same.
 */

import type { IContentDiffLine } from './IContentDiffLine.js';
import type { IContentFieldChangeBase } from './IContentFieldChangeBase.js';

/**
 * The before-and-after of one text field.
 */
export interface IContentTextChange extends IContentFieldChangeBase {
    kind: 'text';

    /** Every line of both versions, in reading order. */
    lines: IContentDiffLine[];

    /**
     * True when the two versions could not be compared line by line within
     * the time limit, because they are very long or very different. The whole
     * old text is then shown removed and the whole new text added, which is
     * still accurate but does not point at the changed lines.
     */
    coarse?: boolean;
}
