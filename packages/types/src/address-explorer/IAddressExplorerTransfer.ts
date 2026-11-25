/**
 * @fileoverview One value movement in or out of a wallet.
 *
 * The rows of the address page's transfers list. A wallet paying itself
 * appears twice, once in each direction.
 */

import type { IAddressExplorerAmount } from './IAddressExplorerAmount.js';
import type { IAddressExplorerUsd } from './IAddressExplorerUsd.js';

/**
 * One movement of TRX, a TRC-10 token, or a TRC-20 token.
 */
export interface IAddressExplorerTransfer {
    /** Block time, ISO 8601. */
    time: string;
    /** Block number. */
    block: number;
    /** The transaction id, hex. */
    txId: string;
    /** Whether the value came in or went out. */
    direction: 'in' | 'out';
    /** The other address, base58. */
    counterparty: string;
    /** The token key: `TRX`, a TRC-10 id, or a TRC-20 contract address. */
    token: string;
    /** The amount moved. */
    amount: IAddressExplorerAmount;
    /** The amount's approximate value in US dollars on its own day, or null when no price is tracked. */
    usd: IAddressExplorerUsd | null;
    /**
     * Where the movement was found: the transaction itself (`contract`), a
     * TRC-20 transfer event (`log`), or a contract's internal transfer
     * (`internal`).
     */
    source: 'contract' | 'log' | 'internal';
}
