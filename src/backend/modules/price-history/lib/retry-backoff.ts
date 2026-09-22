/**
 * @fileoverview Progressive retry delays for an asset the vendors could not
 * price on an attempt, and for an asset whose fetch failed outright.
 *
 * Why progressive rather than a fixed wait: retrying every tick spends the
 * vendors' rate budget re-asking a question nothing has changed the answer to,
 * while a fixed day locks in an answer that may have been wrong for only an
 * hour (a vendor an operator switched off and back on, a pool that gained
 * liquidity). Doubling from an hour up to a day gives a quick second look and
 * then settles at the series' own daily granularity: a token that gains a
 * listing today has no history worth fetching until the next daily close.
 *
 * A failed fetch, where every vendor asked returned an error, gets its own
 * shorter schedule. An error such as a rate limit or an outage usually clears
 * within minutes, so the first retry comes sooner than for an unpriced answer.
 * But retrying on every five-minute tick, as the job did before it had this
 * schedule, kept up the request load on a vendor that was already refusing,
 * and left the failing asset at the head of the deep walk so no other asset
 * advanced behind it.
 */

/** Wait after the first attempt that found no prices. */
export const RETRY_BASE_DELAY_MS = 60 * 60 * 1000;

/**
 * Longest wait between attempts. Once the delay reaches this ceiling the
 * service treats each further failed attempt as an error worth logging,
 * because by then the asset has been unpriced for more than a day.
 */
export const RETRY_MAX_DELAY_MS = 24 * 60 * 60 * 1000;

/** Wait after the first fetch in a row that failed with vendor errors. */
export const FAILURE_RETRY_BASE_DELAY_MS = 15 * 60 * 1000;

/** Longest wait between attempts while an asset's fetches keep failing. */
export const FAILURE_RETRY_MAX_DELAY_MS = 6 * 60 * 60 * 1000;

/**
 * Double a base delay once per attempt after the first, up to a ceiling. Both
 * schedules in this file share it so they cannot drift apart in how they grow.
 *
 * @param attempts - Consecutive attempts in the streak, counting the one just
 *   made, so the smallest meaningful value is 1.
 * @param baseMs - The wait after the first attempt.
 * @param maxMs - The longest wait the schedule allows.
 * @returns Milliseconds to wait before the next attempt.
 */
function progressiveDelayMs(attempts: number, baseMs: number, maxMs: number): number {
    // Capping the exponent keeps a cursor with thousands of attempts from
    // overflowing the maths before the ceiling applies.
    const doublingsToCeiling = Math.ceil(Math.log2(maxMs / baseMs));
    const exponent = Math.min(Math.max(attempts - 1, 0), doublingsToCeiling);
    return Math.min(baseMs * 2 ** exponent, maxMs);
}

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
    return progressiveDelayMs(attempts, RETRY_BASE_DELAY_MS, RETRY_MAX_DELAY_MS);
}

/**
 * How long to wait before retrying an asset whose fetches keep failing with
 * vendor errors. The first failure waits 15 minutes, and each further one
 * doubles that until the six-hour ceiling.
 *
 * @param attempts - Consecutive failed fetches, counting the one just made, so
 *   the smallest meaningful value is 1.
 * @returns Milliseconds to wait before the next attempt.
 */
export function failureRetryDelayMs(attempts: number): number {
    return progressiveDelayMs(attempts, FAILURE_RETRY_BASE_DELAY_MS, FAILURE_RETRY_MAX_DELAY_MS);
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
