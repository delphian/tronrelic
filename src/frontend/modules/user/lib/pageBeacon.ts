/**
 * @fileoverview Client-side page-view beacon.
 *
 * Fires a fire-and-forget `page` traffic event to `POST /api/user/track` on
 * every navigation. Prefers `navigator.sendBeacon` (which survives page unload)
 * and falls back to a `keepalive` fetch.
 *
 * The analytics tid cookie is `httpOnly`, so it is deliberately never read here.
 * The request is same-origin, so the browser attaches the cookie automatically
 * and the backend resolves the tid from it (and the account from the Better Auth
 * session) — the client only needs to report the path it landed on. Soft (App
 * Router) navigations never round-trip the server, so this client beacon is the
 * only way to capture them; hard loads are covered too because the tracker fires
 * on mount.
 */

import { getRuntimeConfig } from '../../../lib/runtimeConfig';

/**
 * Send one page-view beacon for the given path. Best-effort: any failure is
 * swallowed so analytics never interferes with navigation.
 *
 * @param path - The path the visitor navigated to (query string is dropped
 *   server-side; pass the bare pathname).
 * @returns Nothing — the call is fire-and-forget.
 */
export function sendPageView(path: string): void {
    if (typeof window === 'undefined') {
        return;
    }

    try {
        const url = `${getRuntimeConfig().apiUrl}/user/track`;
        const body = JSON.stringify({
            landingPath: path,
            originalReferrer: typeof document !== 'undefined' ? document.referrer || null : null
        });

        // sendBeacon survives an unload that would abort a normal fetch. The
        // Blob carries the JSON content type so the backend body parser reads it.
        if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
            const blob = new Blob([body], { type: 'application/json' });
            if (navigator.sendBeacon(url, blob)) {
                return;
            }
        }

        // Fallback for browsers without sendBeacon (or a queue rejection).
        void fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            credentials: 'include',
            keepalive: true
        }).catch(() => {
            /* analytics is best-effort — never surface a navigation error */
        });
    } catch {
        /* never throw into the navigation path */
    }

    return;
}
