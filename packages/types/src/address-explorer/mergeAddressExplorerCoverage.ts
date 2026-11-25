/**
 * @fileoverview Combines the block coverage of two windows of chain data.
 *
 * The address page's transfers list covers several week-long windows: the
 * backend can scan more than one week for a single page, and the page appends
 * older pages as the visitor asks for them. A gap in any of those weeks can
 * hide transfers, so the coverage shown for the list has to describe every
 * week together. The backend service and the page both need this rule, so it
 * lives here once.
 */

import type { IAddressExplorerCoverage } from './IAddressExplorerCoverage.js';

/**
 * Pick the earlier or later of two optional ISO times, keeping whichever is
 * present when one is null.
 *
 * @param a - One time, or null when that window stored no block.
 * @param b - The other time, or null.
 * @param later - True to keep the later time, false to keep the earlier one.
 * @returns The chosen time, or null when neither is present.
 */
function pickTime(a: string | null, b: string | null, later: boolean): string | null {
    let chosen = a ?? b;
    if (a !== null && b !== null) {
        const bIsLater = Date.parse(b) > Date.parse(a);
        chosen = bIsLater === later ? b : a;
    }
    return chosen;
}

/**
 * Combine the coverage of two windows into the coverage of both together.
 *
 * Block counts add up, the stored-data range widens to span both windows, and
 * the result counts as complete only when both windows are, so a gap in either
 * one still reaches the visitor as a warning.
 *
 * @param first - Coverage of one window.
 * @param second - Coverage of the other window.
 * @returns Coverage of both windows together.
 */
export function mergeAddressExplorerCoverage(first: IAddressExplorerCoverage, second: IAddressExplorerCoverage): IAddressExplorerCoverage {
    return {
        expectedBlocks: first.expectedBlocks + second.expectedBlocks,
        presentBlocks: first.presentBlocks + second.presentBlocks,
        missingBlocks: first.missingBlocks + second.missingBlocks,
        blocksWithoutReceipts: first.blocksWithoutReceipts + second.blocksWithoutReceipts,
        dataFrom: pickTime(first.dataFrom, second.dataFrom, false),
        dataTo: pickTime(first.dataTo, second.dataTo, true),
        complete: first.complete && second.complete,
        blocksComplete: first.blocksComplete && second.blocksComplete
    };
}
