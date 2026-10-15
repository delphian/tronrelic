/**
 * @fileoverview A cached, self-refreshing read of a public backend feed, for
 * the Next.js middleware.
 *
 * The middleware runs on every page request and on the Edge runtime, so it
 * cannot reach MongoDB and must not call the backend per request. Feeds it
 * needs — the admin-managed redirect map and the localization snapshot — are
 * therefore fetched from public backend endpoints and held in module scope. In
 * the standalone Node server that cache persists across requests, so the
 * steady state is about one backend call per feed per TTL window.
 *
 * The behaviour was first written for the redirect map and is kept exactly:
 * the first request after start-up waits for the feed so it can act on it,
 * later requests are served from the cache while a stale feed refreshes in the
 * background, and a failing backend is retried after a short back-off rather
 * than on every request. Every failure keeps the last good value.
 *
 * @module lib/cachedBackendFeed
 */

import { getServerSideApiUrl } from './api-url';

/** Settings for one cached feed. */
export interface ICachedBackendFeedOptions<T> {
    /** Backend path to read, e.g. `/api/redirects`. */
    path: string;
    /** How long a fetched value is served before a background refresh. */
    ttlMs: number;
    /**
     * Wait after a failed refresh before trying again. Shorter than the TTL so
     * recovery is noticed quickly, far longer than one request so a backend
     * incident does not turn into one fetch per page view.
     */
    retryBackoffMs: number;
    /** Request timeout; the feed sits on the request path, so a slow backend must not stall navigation. */
    timeoutMs: number;
    /** Value served before the first successful fetch. */
    initial: T;
    /** Turn a successful response body into the cached value. */
    parse: (body: unknown) => T;
}

/**
 * Create a reader for one backend feed.
 *
 * @param options - Where to read and how long to keep it.
 * @returns A function returning the current value, refreshing it as needed.
 */
export function createCachedBackendFeed<T>(options: ICachedBackendFeedOptions<T>): () => Promise<T> {
    let cached = options.initial;
    /** Epoch ms after which the cached value is stale; 0 means never fetched (cold). */
    let expiry = 0;
    /** Dedupes concurrent background refreshes so only one fetch runs at a time. */
    let refreshInFlight: Promise<void> | null = null;

    /**
     * Fetch the feed and replace the cache. A non-OK response leaves the last
     * good value in place rather than clearing it.
     */
    async function refresh(): Promise<void> {
        const response = await fetch(`${getServerSideApiUrl()}${options.path}`, {
            cache: 'no-store',
            signal: AbortSignal.timeout(options.timeoutMs)
        });
        if (!response.ok) {
            return;
        }
        cached = options.parse(await response.json());
        expiry = Date.now() + options.ttlMs;
    }

    /**
     * Return the current value, refreshing as needed. On a cold cache it waits
     * for the first fetch; once warm it answers immediately and refreshes a
     * stale value in the background.
     *
     * @returns The current feed value.
     */
    async function read(): Promise<T> {
        const now = Date.now();
        if (expiry === 0) {
            // Cold: wait once so the very first request can act on the feed.
            // Arm the expiry either way so later requests take the warm path
            // instead of each waiting while the backend is unreachable.
            try {
                await refresh();
            } catch {
                /* keep the initial value; the warm path retries after the TTL */
            }
            if (expiry === 0) {
                expiry = now + options.ttlMs;
            }
        } else if (now >= expiry && !refreshInFlight) {
            // Snapshot the stale deadline so the settlement handler can tell a
            // successful refresh, which moves the expiry a full TTL ahead, from
            // a failed one, which leaves it here. On failure, arm the short
            // back-off so an unhealthy feed is retried once per window.
            const staleExpiry = expiry;
            refreshInFlight = refresh()
                .catch(() => { /* keep the last good value on failure */ })
                .finally(() => {
                    if (expiry === staleExpiry) {
                        expiry = Date.now() + options.retryBackoffMs;
                    }
                    refreshInFlight = null;
                });
        }
        return cached;
    }

    return read;
}
