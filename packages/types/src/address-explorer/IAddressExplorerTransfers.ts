/**
 * @fileoverview One page of the address page's transfers list.
 *
 * The list runs newest first back to the start of the stored history. Each
 * page reads at most one week, which keeps every read cheap however busy the
 * wallet is.
 */

import type { IAddressExplorerTransfer } from './IAddressExplorerTransfer.js';
import type { IAddressExplorerTransfersCursor } from './IAddressExplorerTransfersCursor.js';

/**
 * Data of one page of transfers.
 */
export interface IAddressExplorerTransfers {
    /** Movements, newest first. */
    transfers: IAddressExplorerTransfer[];
    /** Where older transfers continue, or null when the stored history is exhausted. */
    next: IAddressExplorerTransfersCursor | null;
}
