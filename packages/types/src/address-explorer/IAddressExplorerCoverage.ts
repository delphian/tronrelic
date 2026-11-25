/**
 * @fileoverview How complete the stored chain data is for a section's window.
 *
 * An empty section means nothing happened only when the window is fully
 * covered, so the page reads this before saying an address was inactive.
 */

/**
 * Block coverage of one window of the stored chain data.
 */
export interface IAddressExplorerCoverage {
    /** Blocks the window should hold at the chain's block time. */
    expectedBlocks: number;
    /** Blocks actually stored in the window. */
    presentBlocks: number;
    /** Blocks missing between stored ones. */
    missingBlocks: number;
    /** Stored blocks whose receipts were not fetched, which hides token transfers and fees. */
    blocksWithoutReceipts: number;
    /** Time of the oldest stored block in the window, ISO 8601, or null when none. */
    dataFrom: string | null;
    /** Time of the newest stored block in the window, ISO 8601, or null when none. */
    dataTo: string | null;
    /** True when no block is missing and every block has receipts. */
    complete: boolean;
    /** True when no block is missing, whatever the receipts. */
    blocksComplete: boolean;
}
