/**
 * @fileoverview One page of a wallet's transfers inside a single window.
 *
 * The reader pages within the window it was given; deciding which window to
 * read next is left to its caller.
 */

import type { IAddressExplorerTransfer } from './IAddressExplorerTransfer.js';

/**
 * Transfers from one window, and where the window continues.
 */
export interface IAddressActivityTransfersPage {
    /** Movements, newest first. */
    transfers: IAddressExplorerTransfer[];
    /** The position of the next page inside the same window, or null when the window is finished. */
    nextCursor: string | null;
}
