/**
 * @fileoverview The counterparties section of the address page.
 *
 * Lists the wallet's most frequent counterparties, so the reader sees who it
 * deals with before reading individual transfers.
 */

import type { IAddressExplorerCounterparty } from './IAddressExplorerCounterparty.js';

/**
 * Data of the address page's counterparties section.
 */
export interface IAddressExplorerCounterparties {
    /** How many counterparty, token, and direction groups exist in the window. */
    totalGroups: number;
    /** True when there are more groups than `counterparties` lists. */
    truncated: boolean;
    /** The busiest groups, by number of movements. */
    counterparties: IAddressExplorerCounterparty[];
}
