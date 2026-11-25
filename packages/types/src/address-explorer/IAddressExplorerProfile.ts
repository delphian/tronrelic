/**
 * @fileoverview The summary section of the address page.
 *
 * Gives the headline totals, the breakdown by token and direction, and any
 * groups of counterparties that look alike, which is how address poisoning
 * shows up in a wallet's history.
 */

import type { IAddressExplorerActivity } from './IAddressExplorerActivity.js';
import type { IAddressExplorerTokenActivity } from './IAddressExplorerTokenActivity.js';

/**
 * Data of the address page's summary section.
 */
export interface IAddressExplorerProfile {
    /** The wallet's totals over the window. */
    activity: IAddressExplorerActivity;
    /** One row per token and direction, busiest first. */
    byToken: IAddressExplorerTokenActivity[];
    /** True when the wallet moved more tokens than `byToken` lists. */
    truncated: boolean;
    /**
     * Sets of counterparties sharing their first and last characters, each
     * sorted. A set means someone may be sending lookalike addresses to trick
     * the wallet's owner into copying the wrong one.
     */
    lookalikeGroups: string[][];
}
