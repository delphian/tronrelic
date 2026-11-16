/**
 * @file ContentDiffOp.ts
 *
 * What happened to one piece of a compared value: it is in both versions, only
 * in the new one, or only in the old one. Shared by every part of a content
 * change set (words, lines, and list items) so a renderer handles one small
 * vocabulary everywhere.
 */

/**
 * `equal` — present in both the live version and the version under review.
 * `added` — present only in the version under review. `removed` — present
 * only in the live version.
 */
export type ContentDiffOp = 'equal' | 'added' | 'removed';
