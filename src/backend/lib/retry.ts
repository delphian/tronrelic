/**
 * @fileoverview Retry an async operation with capped exponential backoff and
 * jitter, the pattern most HTTP APIs expect from a well-behaved client.
 *
 * Why it matters: a caller that retries on a fixed schedule, retries a request
 * that can never succeed, or ignores the server's `Retry-After` header turns one
 * failure into a burst of requests. Against a rate-limited vendor that burst
 * keeps the limit in force. This helper retries only errors a second attempt can
 * fix, spreads the waits with random jitter so many callers do not retry in
 * lockstep, caps each wait, and waits at least as long as the server asked.
 */

/** How {@link retry} paces and filters its attempts. */
export interface IRetryOptions {
    /** Retries after the first attempt. Zero means one attempt only. */
    retries?: number;
    /** Base wait before the first retry, before jitter is applied. */
    delayMs?: number;
    /** Multiplier applied to the base wait after each retry. */
    factor?: number;
    /** Ceiling on one backoff wait, so a long retry chain cannot stall for minutes. */
    maxDelayMs?: number;
    /**
     * Longest `Retry-After` the helper will honour inline. A server asking for a
     * longer pause ends the retries, and the caller's own schedule tries again later.
     */
    maxRetryAfterMs?: number;
    /** Decides whether an error is worth another attempt. Defaults to {@link isRetryableError}. */
    shouldRetry?: (error: unknown) => boolean;
    /**
     * Called before each wait, for logging. Receives the number of the attempt
     * that just failed, its error, and how long the helper is about to wait.
     * Throwing from it ends the retries with that error.
     */
    onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
    /**
     * How the helper waits between attempts. Defaults to a real timer. Supplied
     * by tests that exercise every retry and must not sit through real delays.
     */
    sleep?: (ms: number) => Promise<void>;
}

/** Default ceiling on one backoff wait. */
const DEFAULT_MAX_DELAY_MS = 30_000;

/** Default ceiling on a `Retry-After` the helper will wait out inline. */
const DEFAULT_MAX_RETRY_AFTER_MS = 60_000;

/**
 * HTTP statuses a later attempt can succeed on: request timeout, too early, and
 * too many requests. Every 5xx status is also retryable and is checked separately.
 */
const RETRYABLE_CLIENT_STATUSES: ReadonlySet<number> = new Set([408, 425, 429]);

/**
 * Pause between attempts, the default when the caller supplies no `sleep`.
 *
 * @param ms - How long to wait.
 * @returns A promise that resolves once the time has passed.
 */
const sleepFor = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Read the HTTP status off a failed request, so retry decisions and callers can
 * tell a server's answer apart from a network failure.
 *
 * @param error - The thrown error, usually from axios.
 * @returns The response status, or undefined when no response arrived.
 */
export function httpStatusOf(error: unknown): number | undefined {
    return (error as { response?: { status?: number } })?.response?.status;
}

/**
 * Decide whether a failed request is worth repeating. A network failure, a
 * timeout, a rate limit, or a server error may clear on its own. Any other 4xx
 * status is the server's final answer about this request, such as a bad key
 * (401), a forbidden range (403), or an unknown resource (404), and repeating it
 * only spends the caller's rate budget on the same refusal.
 *
 * @param error - The thrown error.
 * @returns True when another attempt could succeed.
 */
export function isRetryableError(error: unknown): boolean {
    const status = httpStatusOf(error);
    return status === undefined || status >= 500 || RETRYABLE_CLIENT_STATUSES.has(status);
}

/**
 * Read the server's `Retry-After` header, so a rate-limited caller waits as
 * long as the server asked instead of guessing. The header may be a number of
 * seconds or an HTTP date.
 *
 * @param error - The thrown error.
 * @returns The requested wait in milliseconds, or undefined when the header is absent or unreadable.
 */
export function retryAfterMs(error: unknown): number | undefined {
    const headers = (error as { response?: { headers?: Record<string, unknown> } })?.response?.headers;
    const raw = headers?.['retry-after'];
    let result: number | undefined;
    if (typeof raw === 'string' || typeof raw === 'number') {
        const seconds = Number(raw);
        if (Number.isFinite(seconds)) {
            result = Math.max(0, seconds * 1000);
        } else {
            const at = Date.parse(String(raw));
            result = Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
        }
    }
    return result;
}

/**
 * Work out how long to wait before the next attempt, or decide not to retry.
 * The backoff is capped and then jittered between half and all of its value,
 * which keeps a minimum pause while stopping concurrent callers from retrying
 * at the same instant. A `Retry-After` from the server sets a floor under that.
 *
 * @param error - The error the last attempt threw, read for `Retry-After`.
 * @param backoffMs - The un-jittered backoff for this attempt.
 * @param maxDelayMs - Ceiling on the backoff.
 * @param maxRetryAfterMs - Longest server-requested wait to honour inline.
 * @returns The wait in milliseconds, or null when the server asked for longer than the caller will wait.
 */
function nextDelayMs(error: unknown, backoffMs: number, maxDelayMs: number, maxRetryAfterMs: number): number | null {
    const requested = retryAfterMs(error);
    let result: number | null = null;
    if (requested === undefined || requested <= maxRetryAfterMs) {
        const capped = Math.min(backoffMs, maxDelayMs);
        const jittered = capped / 2 + Math.random() * (capped / 2);
        result = Math.max(jittered, requested ?? 0);
    }
    return result;
}

/**
 * Run an async operation, retrying failures that a later attempt could fix.
 * The first attempt runs immediately. Each retry waits a jittered, capped,
 * exponentially growing backoff, or longer if the server sent `Retry-After`.
 * An error that {@link IRetryOptions.shouldRetry} rejects is rethrown at once.
 *
 * @param fn - The operation to attempt, such as one HTTP request.
 * @param options - Retry count, pacing, and the retry filter.
 * @returns The operation's result from the first attempt that succeeds.
 * @throws The last error when every allowed attempt fails or the error is not retryable.
 */
export async function retry<T>(fn: () => Promise<T>, options: IRetryOptions = {}): Promise<T> {
    const {
        retries = 3,
        delayMs = 500,
        factor = 2,
        maxDelayMs = DEFAULT_MAX_DELAY_MS,
        maxRetryAfterMs = DEFAULT_MAX_RETRY_AFTER_MS,
        shouldRetry = isRetryableError,
        onRetry,
        sleep = sleepFor
    } = options;

    let attempt = 0;
    let backoff = delayMs;
    let outcome: { ok: true; value: T } | { ok: false; error: unknown } | null = null;

    while (outcome === null) {
        try {
            outcome = { ok: true, value: await fn() };
        } catch (error) {
            const wait = attempt < retries && shouldRetry(error)
                ? nextDelayMs(error, backoff, maxDelayMs, maxRetryAfterMs)
                : null;
            if (wait === null) {
                outcome = { ok: false, error };
            } else {
                attempt += 1;
                onRetry?.(attempt, error, wait);
                await sleep(wait);
                backoff *= factor;
            }
        }
    }

    if (!outcome.ok) {
        throw outcome.error instanceof Error ? outcome.error : new Error(String(outcome.error));
    }
    return outcome.value;
}
