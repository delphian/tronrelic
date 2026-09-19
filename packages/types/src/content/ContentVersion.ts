/**
 * @file ContentVersion.ts
 *
 * Which of an item's two versions a read asks the content author for. A
 * managed content author keeps both: the `working` version holds the latest
 * edit, and the `approved` version holds the content as it stood when a curator
 * last approved it. Keeping both is what lets an approved item stay live while
 * an edit to it waits for review.
 */

/**
 * `working` — the latest edit, whatever its review state. `approved` — the
 * version a curator last approved. Core decides which version a public read is
 * served; the author only returns the version it is asked for.
 */
export type ContentVersion = 'working' | 'approved';
