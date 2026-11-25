/**
 * @fileoverview One token and direction of a wallet's value movements.
 *
 * Breaks the headline totals down so a reader can see which tokens the wallet
 * moves and which way. A high zero-value count on incoming rows is the mark of
 * address poisoning spam aimed at the wallet.
 */

import type { IAddressExplorerAmount } from './IAddressExplorerAmount.js';
import type { IAddressExplorerUsd } from './IAddressExplorerUsd.js';

/**
 * A wallet's movements of one token in one direction over a window.
 */
export interface IAddressExplorerTokenActivity {
    /** Whether the value came into the wallet or went out of it. */
    direction: 'in' | 'out';
    /** The token key: `TRX`, a TRC-10 id, or a TRC-20 contract address. */
    token: string;
    /** Movements counted. */
    transfers: number;
    /** Movements that carried no value. */
    zeroValueTransfers: number;
    /** The total moved. */
    total: IAddressExplorerAmount;
    /** The total's approximate value in US dollars, or null when no price is tracked. */
    usd: IAddressExplorerUsd | null;
    /** Distinct counterparties for this token and direction. */
    counterparties: number;
    /** Time of the earliest such movement, ISO 8601. */
    firstAt: string;
    /** Time of the latest such movement, ISO 8601. */
    lastAt: string;
}
