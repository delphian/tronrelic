/**
 * @fileoverview A wallet's value-movement totals over the summary span.
 *
 * These are the headline figures of the address page. They count transfers of
 * TRX, TRC-10, and TRC-20 value only; staking, delegation, and voting move no
 * value and are not included.
 */

/**
 * Totals of one wallet's value movements over a window.
 */
export interface IAddressExplorerActivity {
    /** Value movements in or out of the wallet. */
    transfers: number;
    /** Distinct transactions those movements belong to. */
    transactions: number;
    /** Distinct addresses the wallet sent value to or received it from. */
    counterparties: number;
    /** Time of the earliest movement in the window, ISO 8601, or null when there were none. */
    firstAt: string | null;
    /** Time of the latest movement in the window, ISO 8601, or null when there were none. */
    lastAt: string | null;
}
