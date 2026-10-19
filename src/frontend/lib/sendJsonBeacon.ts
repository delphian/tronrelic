/**
 * @fileoverview Fire-and-forget JSON post that survives the page unloading.
 *
 * Analytics beacons are often sent at the moment the browser is leaving the
 * page: a page-view beacon fired as a tab closes, or a language switcher click
 * whose link starts a full page load. An ordinary `fetch` is cancelled when the
 * page unloads, so the event is lost. `navigator.sendBeacon` hands the request
 * to the browser to finish on its own, and a `keepalive` fetch does the same
 * where `sendBeacon` is missing or refuses the payload. Keeping both paths in
 * one helper means every beacon gets the same delivery guarantee.
 *
 * @module lib/sendJsonBeacon
 */

/**
 * Post a JSON body to a same-origin endpoint without waiting for, or
 * reporting, the result.
 *
 * The request is same-origin, so the browser attaches the visitor's cookies
 * on either path and the backend can resolve the analytics cookie and session
 * itself. Any failure is swallowed, because analytics must never interfere
 * with what the visitor is doing.
 *
 * @param url - Absolute endpoint URL, built by the caller from `getRuntimeConfig().apiUrl`.
 * @param payload - Value serialised as the JSON body.
 * @returns Nothing; delivery is best-effort.
 */
export function sendJsonBeacon(url: string, payload: unknown): void {
    try {
        const body = JSON.stringify(payload);
        // The Blob carries the JSON content type so the backend's body parser
        // reads it; sendBeacon would otherwise send text/plain.
        const queued = typeof navigator !== 'undefined'
            && typeof navigator.sendBeacon === 'function'
            && navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));

        if (!queued) {
            void fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
                credentials: 'include',
                keepalive: true
            }).catch(() => {
                /* analytics is best-effort — never surface a network error */
            });
        }
    } catch {
        /* never throw into the caller's interaction */
    }

    return;
}
