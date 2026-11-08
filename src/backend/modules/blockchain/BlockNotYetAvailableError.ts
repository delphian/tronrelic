/**
 * @fileoverview The error `TronGridClient.getBlockByNumber()` throws when
 * TronGrid answers a block request successfully but sends no block.
 *
 * Why it exists: TronGrid spreads requests across several nodes, and the node
 * that reports the chain head can be a few seconds ahead of the node that
 * serves a block by number. Asked for a block it does not have yet, a node
 * replies with HTTP 200 and an empty body. That reply is not a network error,
 * so the transport retry never fired, and sync failed the block at once and
 * parked it in a five-minute cooldown. A distinct error type lets the client
 * retry this one case on its own short schedule, separately from network
 * failures.
 */

/**
 * Thrown when TronGrid returns a successful response for a block height that
 * carries no block header timestamp, meaning the node that answered has not
 * served that block yet.
 *
 * Callers can match it with `instanceof` to tell "not served yet" apart from a
 * transport failure, since the two call for different handling.
 */
export class BlockNotYetAvailableError extends Error {
    /** The block height TronGrid had not served when the retries ran out. */
    readonly blockNumber: number;

    /**
     * Record which block was missing, so the error message and any log line
     * built from it name the height an operator needs to check.
     *
     * @param blockNumber - The height that came back empty, carried on the
     *                      error so a caller does not have to thread it
     *                      through separately.
     */
    constructor(blockNumber: number) {
        super(`TronGrid has not served block ${blockNumber} yet; the reply had no block header timestamp`);
        this.name = 'BlockNotYetAvailableError';
        this.blockNumber = blockNumber;
    }
}
