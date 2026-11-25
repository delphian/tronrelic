/**
 * @fileoverview A request for one page of a wallet's transfers.
 *
 * Transfers are read one bounded window at a time, so the request names the
 * window and the position inside it.
 */

/**
 * Which wallet, which window, where in it to continue, and whose quota to charge.
 */
export interface IAddressActivityTransfersQuery {
    /** The wallet, base58, already checksum-verified. */
    address: string;
    /** Inclusive start of the window, ISO 8601. */
    from: string;
    /** Exclusive end of the window, ISO 8601. */
    to: string;
    /** The position inside the window from the previous page, or undefined for its newest rows. */
    cursor?: string;
    /** The key the hourly read quota is counted under, normally the visitor's user id. */
    quotaKey: string;
}
