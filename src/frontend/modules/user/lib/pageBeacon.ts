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
 * Per-tab record of the last URL this tab reported, used to derive a
 * per-navigation referrer.
 *
 * `sessionStorage` rather than a module variable because it is scoped to the
 * one tab *and* survives a reload — a reload is exactly the case a module
 * variable would lose, and the case where `document.referrer` is most
 * misleading.
 */
const LAST_URL_KEY = 'tronrelic_beacon_last_url';

/**
 * Resolve the referrer to report for this navigation.
 *
 * `document.referrer` is fixed when the Document is created and is *not*
 * updated by `pushState`, so an App Router soft navigation — and a reload —
 * still reports whatever sent the visitor to the tab originally. Reporting it
 * on every beacon makes each navigation in a long-lived tab look like a fresh
 * external arrival, which double-counts acquisition: a session resumed after
 * the 30-minute gap gets credited to the original source a second time instead
 * of being recognised as a continuation.
 *
 * So only a tab's *first* beacon may use `document.referrer` — that is the one
 * navigation it actually describes. Every later beacon reports the previous
 * in-tab URL, which makes an intra-tab continuation a genuine self-referral
 * that the backend's acquisition filter can recognise and exclude.
 *
 * @returns The referrer URL for this navigation, or null when the tab has no
 *   prior page and no external referrer (a direct arrival).
 */
function resolveNavigationReferrer(): string | null {
    const documentReferrer = typeof document !== 'undefined' ? document.referrer || null : null;

    try {
        const previousUrl = window.sessionStorage.getItem(LAST_URL_KEY);
        window.sessionStorage.setItem(LAST_URL_KEY, window.location.href);
        if (previousUrl) {
            return previousUrl;
        }
    } catch {
        // Storage can be unavailable (private mode, blocked cookies). Fall back
        // to document.referrer — the pre-existing behaviour — rather than
        // dropping the beacon.
    }

    return documentReferrer;
}

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
            originalReferrer: resolveNavigationReferrer()
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
