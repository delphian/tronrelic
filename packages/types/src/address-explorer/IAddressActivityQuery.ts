/**
 * @fileoverview A request for one summary section of a wallet's activity.
 *
 * Summary sections always end now, so the request names a span in hours
 * rather than two times.
 */

/**
 * Which wallet to read, over how many hours, and whose quota to charge.
 */
export interface IAddressActivityQuery {
    /** The wallet, base58, already checksum-verified. */
    address: string;
    /** How many hours back from now to read. */
    hours: number;
    /** The key the hourly read quota is counted under, normally the visitor's user id. */
    quotaKey: string;
}
