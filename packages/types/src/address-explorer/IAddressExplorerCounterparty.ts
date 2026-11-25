/**
 * @fileoverview One counterparty of a wallet, for one token and direction.
 *
 * Answers "who does this wallet deal with". A counterparty the wallet both
 * sends to and receives from appears once per direction, and once per token.
 */

import type { IAddressExplorerAmount } from './IAddressExplorerAmount.js';
import type { IAddressExplorerUsd } from './IAddressExplorerUsd.js';

/**
 * A wallet's movements with one other address in one token and direction.
 */
export interface IAddressExplorerCounterparty {
    /** The other address, base58. */
    counterparty: string;
    /** `in` when the counterparty sent value to the wallet, `out` when it received from it. */
    direction: 'in' | 'out';
    /** The token key: `TRX`, a TRC-10 id, or a TRC-20 contract address. */
    token: string;
    /** Movements counted. */
    transfers: number;
    /** Distinct transactions those movements belong to. */
    transactions: number;
    /** The total moved. */
    total: IAddressExplorerAmount;
    /** The total's approximate value in US dollars, or null when no price is tracked. */
    usd: IAddressExplorerUsd | null;
    /** Time of the earliest such movement, ISO 8601. */
    firstAt: string;
    /** Time of the latest such movement, ISO 8601. */
    lastAt: string;
    /** Other counterparties sharing this one's first and last characters, when any do. */
    resemblesCounterparties?: string[];
}
