/**
 * @file IContentDiffLine.ts
 *
 * One line of a compared text field, in the unified layout a code review uses:
 * unchanged lines once, a removed line followed by the line that replaced it.
 * A unified layout fits the narrow review sheet beside the queue list, where a
 * side-by-side layout would leave each column too thin to read prose.
 */

import type { ContentDiffOp } from './ContentDiffOp.js';
import type { IContentDiffSegment } from './IContentDiffSegment.js';

/**
 * A single line of a text diff.
 */
export interface IContentDiffLine {
    /** Whether the line is unchanged, only in the new version, or only in the old one. */
    op: ContentDiffOp;

    /**
     * The line's text, without its line break. An unchanged line, or a line
     * with no counterpart on the other side, is one segment carrying the
     * line's own `op`. A removed line paired with the added line that replaced
     * it is split by word: `equal` segments are the words both share, and
     * `removed` (or `added`) segments are the words that changed.
     */
    segments: IContentDiffSegment[];
}
