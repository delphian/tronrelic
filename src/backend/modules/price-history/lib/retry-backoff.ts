/**
 * @fileoverview Progressive retry delay for an asset the vendors could not
 * price on an attempt.
 *
 * Why progressive rather than a fixed wait: retrying every tick spends the
 * vendors' rate budget re-asking a question nothing has changed the answer to,
 * while a fixed day locks in an answer that may have been wrong for only an
 * hour (a vendor an operator switched off and back on, a pool that gained
 * liquidity). Doubling from an hour up to a day gives a quick second look and
 * then settles at the series' own daily granularity: a token that gains a
 * listing today has no history worth fetching until the next daily close.
 */

/** Wait after the first attempt that found no prices. */
export const RETRY_BASE_DELAY_MS = 60 * 60 * 1000;

/**
 * Longest wait between attempts. Once the delay reaches this ceiling the
 * service treats each further failed attempt as an error worth logging,
 * because by then the asset has been unpriced for more than a day.
 */
export const RETRY_MAX_DELAY_MS = 24 * 60 * 60 * 1000;

/**
 * Doublings needed to go from the base delay to the ceiling. Used to cap the
 * exponent so a cursor with thousands of attempts cannot overflow the maths.
 */
const DOUBLINGS_TO_CEILING = Math.ceil(Math.log2(RETRY_MAX_DELAY_MS / RETRY_BASE_DELAY_MS));

/**
 * How long to wait before retrying an asset, given how many consecutive
 * attempts have found no prices. The first failed attempt waits an hour, and
 * each further one doubles that until the daily ceiling.
 *
 * @param attempts - Consecutive attempts that found no prices, counting the
 *   one just made, so the smallest meaningful value is 1.
 * @returns Milliseconds to wait before the next attempt.
 */
export function retryDelayMs(attempts: number): number {
    const exponent = Math.min(Math.max(attempts - 1, 0), DOUBLINGS_TO_CEILING);
    return Math.min(RETRY_BASE_DELAY_MS * 2 ** exponent, RETRY_MAX_DELAY_MS);
}

/**
 * Whether the backoff has reached its daily ceiling for this attempt count.
 * The service escalates its log level at this point so an asset that has
 * stayed unpriced through the whole schedule shows up on the logs page rather
 * than only on the coverage table.
 *
 * @param attempts - Consecutive attempts that found no prices, counting the one just made.
 * @returns True once the delay for this attempt is the ceiling.
 */
export function isRetryAtCeiling(attempts: number): boolean {
    return retryDelayMs(attempts) >= RETRY_MAX_DELAY_MS;
}
