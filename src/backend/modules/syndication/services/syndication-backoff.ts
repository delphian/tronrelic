/**
 * @file syndication-backoff.ts
 *
 * The retry timing policy for the syndication relay, isolated as a pure function
 * so it is trivially unit-tested and tuned in one place. A failed leg must not
 * hammer a struggling external API, nor wait so long that a transient blip
 * delays delivery for hours — exponential backoff with a cap is the well-worn
 * answer, and keeping it pure (attempt number in, delay out) keeps the relay
 * logic free of timing arithmetic.
 *
 * @module modules/syndication/services/syndication-backoff
 */

/** Base delay (ms) before the first retry — one relay tick. */
export const BASE_BACKOFF_MS = 60_000;

/** Ceiling (ms) the exponential curve is clamped to, so retries never stall for hours. */
export const MAX_BACKOFF_MS = 60 * 60_000;

/**
 * Compute the delay before the next attempt of a leg that just failed, as a
 * capped exponential of the attempt count. The curve is `base * 2^(attempt-1)`
 * clamped to `MAX_BACKOFF_MS`, so attempt 1 waits one base interval, attempt 2
 * waits two, doubling until the cap — giving a struggling destination room to
 * recover without abandoning the leg.
 *
 * @param attempt - The 1-based number of the attempt that just failed.
 * @returns Milliseconds to wait before the next attempt.
 */
export function backoffMs(attempt: number): number {
    const exponent = Math.max(0, attempt - 1);
    const raw = BASE_BACKOFF_MS * 2 ** exponent;
    return Math.min(MAX_BACKOFF_MS, raw);
}
