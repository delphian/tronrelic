/**
 * @fileoverview What one `syncDefinitions` pass changed.
 */

/**
 * The counts one definition sync produced, for the source's log line.
 *
 * A source syncs its definitions on every tag sync, so these counts are how
 * an operator tells a source that defines its tags from one whose
 * definitions are all being refused.
 */
export interface IAddressTagDefinitionSyncResult {
    /** The source id the pass ran for. */
    source: string;
    /** Definitions written, new or rewritten. */
    defined: number;
    /** Stored definitions removed because the source no longer sent them. */
    removed: number;
    /** Definitions refused for a bad tag or meaning, or for repeating a tag already in the batch. */
    rejected: number;
}
