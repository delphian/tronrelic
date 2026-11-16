/**
 * @file IContentDiffSegment.ts
 *
 * One run of text inside a compared line. A changed line is split into
 * segments so a reviewer sees which words changed, not only which line did.
 * The text is plain and unescaped; a renderer must insert it as text, never as
 * HTML, because it comes from content a non-curator wrote.
 */

import type { ContentDiffOp } from './ContentDiffOp.js';

/**
 * A run of characters that share one diff outcome.
 */
export interface IContentDiffSegment {
    /** Whether this run is unchanged, new, or gone. */
    op: ContentDiffOp;

    /** The characters of the run, including any spaces between words. */
    text: string;
}
