/**
 * Next.js middleware for request processing.
 *
 * Handles:
 * - Legacy URL redirects with referrer preservation
 * - Custom headers for server components (pathname for widget zone routing)
 *
 * Referrer preservation prevents attribution loss that occurs with static
 * redirects, where the browser overwrites document.referrer with the
 * redirect source URL.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getServerSideApiUrl } from './lib/api-url';

/** Cookie name for preserved external referrer */
export const ORIGINAL_REFERRER_COOKIE = '_original_ref';

/** Cookie max age in seconds (5 minutes) */
const COOKIE_MAX_AGE = 300;

/**
 * UUID v4 validator for the analytics traffic id. The tid is the only
 * server-issued id the middleware mints — Better Auth owns identity now —
 * so this guards against a malformed inbound tid cookie before we reuse it.
 */
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Analytics traffic id. A UUID decoupled from identity that keys
 * `traffic_events`, minted here so it is stable from the very first SSR
 * paint. Better Auth owns identity; the tid is the sole server-issued id
 * the middleware mints. Spec mirrors the backend `traffic-cookies.ts`
 * helper: HttpOnly, SameSite=Lax, Secure in production, one-year max-age,
 * unsigned.
 */
const TID_COOKIE_NAME = 'tronrelic_tid';
const TID_COOKIE_MAX_AGE_SECONDS = 31536000;

/**
 * Referral cookie — first-touch capture of an inbound `?ref=<code>` so a
 * later signup can attribute to the referrer. 90-day window. Mirrors the
 * backend `traffic-cookies.ts` spec.
 */
const REF_COOKIE_NAME = 'tronrelic_ref';
const REF_COOKIE_MAX_AGE_SECONDS = 7776000;
const REFERRAL_CODE_REGEX = /^[A-Za-z0-9_-]{4,32}$/;

/**
 * Cap on the JSON body forwarded to the backend bootstrap endpoint. The
 * payload only carries small derived signals (landing path, UTM params,
 * `document.referrer`) so 1 KB is generous; the cap exists to defend
 * against a malicious or pathological URL that could otherwise inflate
 * the request indefinitely.
 */
const BOOTSTRAP_BODY_BYTE_CAP = 1024;

/**
 * Headers we want the backend to see on `POST /api/user/bootstrap` so the
 * Phase 1 traffic-event row carries real visitor context instead of the
 * Docker bridge IP and Node default User-Agent. Order matches the columns
 * in the `traffic_events` ClickHouse table.
 */
const FORWARDED_HEADERS = [
    'user-agent',
    'referer',
    'accept-language',
    'sec-ch-ua',
    'sec-ch-ua-mobile',
    'sec-ch-ua-platform',
    'sec-fetch-dest',
    'sec-fetch-mode',
    'sec-fetch-site',
    // Cloudflare edge headers, forwarded verbatim. `cf-ray` marks a request
    // that traversed the Cloudflare proxy (absent on direct-to-origin hits),
    // `cf-ipcountry` is the edge geo, and `cf-connecting-ip` is the client
    // address the backend's getClientIP prefers over the spoofable
    // X-Forwarded-For chain. These are unverified client-supplied headers a
    // direct-to-origin client can forge, so cf-ray is consistency hygiene,
    // not a trust boundary — the origin firewall allow-listing Cloudflare's
    // ranges is authoritative.
    'cf-ray',
    'cf-ipcountry',
    'cf-connecting-ip'
] as const;

/** UTM keys we accept from the URL. Anything else is dropped. */
const UTM_KEYS = ['source', 'medium', 'campaign', 'term', 'content'] as const;

/**
 * Ad-network click-ID query params that mark a paid landing (auto-tagged ads
 * carry no UTM at all — a Google Ads click arrives with only `gclid`). Only
 * the param *name* is forwarded to the backend, never its value. `fbclid` is
 * deliberately absent: Facebook appends it to organic clicks too. Mirror of
 * `PAID_CLICK_IDS` in the traffic module's `channel-classifier.ts` (frontend
 * cannot import backend modules) — keep the two lists in sync.
 */
const PAID_CLICK_ID_KEYS = ['gclid', 'gbraid', 'wbraid', 'dclid', 'msclkid', 'ttclid', 'twclid', 'li_fat_id'] as const;

/**
 * Build the JSON body for the backend bootstrap call.
 *
 * Carries the derived per-request context that the backend cannot see by
 * inspecting the inbound request alone:
 *   - `landingPath`  the path the visitor actually requested (the bootstrap
 *     fetch itself targets `/api/user/bootstrap`, which would otherwise be
 *     the only path the backend sees);
 *   - `utm` UTM params parsed from the request URL's query string;
 *   - `originalReferrer` value preserved by the legacy-redirect path in
 *     `_original_ref` cookie when the visitor arrived via an external link.
 *
 * The body is capped at `BOOTSTRAP_BODY_BYTE_CAP` bytes. Oversized payloads
 * fall back to an empty object so the backend bootstrap still succeeds.
 */
function buildBootstrapBody(request: NextRequest, tid: string, referralCode: string | null): string {
    const utm: Record<string, string> = {};
    for (const key of UTM_KEYS) {
        const value = request.nextUrl.searchParams.get(`utm_${key}`);
        if (value) {
            utm[key] = value;
        }
    }

    const originalReferrer = request.cookies.get(ORIGINAL_REFERRER_COOKIE)?.value;

    const payload: Record<string, unknown> = {
        landingPath: request.nextUrl.pathname,
        // Forward the analytics tid so the backend keys the bootstrap
        // traffic_event on the same id this middleware persists in the
        // cookie, rather than minting a divergent one server-side.
        tid
    };
    if (Object.keys(utm).length > 0) {
        payload.utm = utm;
    }
    // Forward which paid click-ID param appeared (name only, never the value)
    // so the backend channel classifier can mark auto-tagged ad landings as
    // paid despite the absence of UTM parameters.
    const clickId = PAID_CLICK_ID_KEYS.find(key => request.nextUrl.searchParams.has(key));
    if (clickId) {
        payload.clickId = clickId;
    }
    if (originalReferrer) {
        payload.originalReferrer = originalReferrer;
    }
    if (referralCode) {
        payload.ref = referralCode;
    }

    const serialized = JSON.stringify(payload);
    // The middleware runs on Next.js's Edge runtime where `Buffer` is not
    // guaranteed; `TextEncoder` is a Web-standard API and gives us the
    // UTF-8 byte length directly without a Node-only dependency.
    if (new TextEncoder().encode(serialized).byteLength > BOOTSTRAP_BODY_BYTE_CAP) {
        return '{}';
    }
    return serialized;
}

/**
 * Forward selected request headers to the backend bootstrap call.
 *
 * The middleware runs behind the public ingress, so by the time a request
 * reaches us the original client IP and user-agent are visible only on
 * inbound headers — not on the server-to-server fetch we're about to make.
 * Without this forwarding the backend would see the Docker bridge IP and
 * `node-fetch`'s default UA on every event.
 *
 * `X-Forwarded-For` is preserved verbatim from the inbound chain (or
 * seeded from `X-Real-IP` when no chain exists) so the backend's
 * `getClientIP` helper still reads the original client at the head of
 * the list. We deliberately do NOT append our own hop: the next hop is
 * an in-cluster server-to-server fetch and adding the Docker bridge IP
 * would shift the original client out of the head position, defeating
 * the helper.
 */
function buildForwardedHeaders(request: NextRequest): Record<string, string> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json'
    };

    for (const name of FORWARDED_HEADERS) {
        const value = request.headers.get(name);
        if (value) {
            headers[name] = value;
        }
    }

    // Preserve the original client IP at the head of X-Forwarded-For so
    // the backend's getClientIP reads through to the real visitor instead
    // of the Docker bridge.
    const inboundForwardedFor = request.headers.get('x-forwarded-for');
    const directIp = request.headers.get('x-real-ip');
    if (inboundForwardedFor) {
        headers['x-forwarded-for'] = inboundForwardedFor;
    } else if (directIp) {
        headers['x-forwarded-for'] = directIp;
    }

    return headers;
}

/**
 * Emit the first-touch `bootstrap` traffic event via the backend.
 *
 * Fired once per new visitor (when the analytics tid is freshly minted).
 * The backend keys the `traffic_events` row on the tid carried in the body
 * and enriches it with the forwarded client headers. Better Auth owns
 * identity, so this no longer mints or returns a user id — it is a
 * fire-and-forget analytics beacon. Failures are swallowed: a backend
 * outage must never block a page load.
 *
 * The fetch is server-to-server (within the same Docker network). We
 * forward the visitor context the backend needs to record a useful
 * `traffic_events` row: client headers (UA, Referer, Sec-CH-UA*,
 * Sec-Fetch-*), the original client IP via `X-Forwarded-For`, and a small
 * JSON body with the tid, landing path, UTM params, and `_original_ref`.
 */
async function emitBootstrapEvent(
    request: NextRequest,
    tid: string,
    referralCode: string | null
): Promise<void> {
    // Resolved outside the try: a missing SITE_BACKEND is a deployment
    // error that must surface, while the fetch below stays best-effort.
    const backendUrl = getServerSideApiUrl();
    try {
        await fetch(`${backendUrl}/api/user/bootstrap`, {
            method: 'POST',
            headers: buildForwardedHeaders(request),
            body: buildBootstrapBody(request, tid, referralCode),
            // Prevent the edge runtime from caching the analytics beacon.
            cache: 'no-store',
            signal: AbortSignal.timeout(3000)
        });
    } catch {
        // Ignore — analytics is best-effort, never load-bearing.
    }
}

/**
 * Redirect rule definition.
 */
interface RedirectRule {
    pattern: string;
    isPrefix: boolean;
    destination: string;
    permanent: boolean;
}

/**
 * How long (ms) a fetched redirect map is served before a background refresh.
 * Matches the backend feed's Cache-Control, so an admin-added rule goes live in
 * at most this long.
 */
const REDIRECT_CACHE_TTL_MS = 60_000;

/**
 * Backoff (ms) applied after a failed warm refresh (non-OK response or a thrown
 * fetch). Shorter than the healthy TTL so recovery is detected quickly, yet far
 * longer than a single request — it caps the frontend to one feed retry per
 * window during a backend incident instead of one fetch per page view. Without
 * it the warm path leaves the already-expired cache in place and re-fetches on
 * every request, amplifying load against an already-unhealthy backend.
 */
const REDIRECT_RETRY_BACKOFF_MS = 10_000;

/**
 * Timeout (ms) for the server-to-server redirect-map fetch. The map load sits on
 * the request critical path, so a slow backend must not stall navigation — on
 * timeout the last-known (or empty) map is used and the request proceeds.
 */
const REDIRECT_FETCH_TIMEOUT_MS = 3000;

/**
 * Module-scope cache of the admin-managed redirect map. Redirect rules are no
 * longer hardcoded here — they live in Mongo (`module_traffic_redirects`) and
 * are edited from `/system/traffic`. This middleware runs on the Edge runtime
 * and cannot reach Mongo directly, so it pulls the map from the backend's public
 * `/api/redirects` feed and caches it in module scope. In the standalone Node
 * server this cache persists across requests in one instance, so the steady
 * state is ~one backend call per TTL window, not per request.
 */
let cachedRedirectRules: RedirectRule[] = [];

/** Epoch ms after which the cached map is stale; 0 means never fetched (cold). */
let redirectCacheExpiry = 0;

/** Dedupes concurrent background refreshes so only one fetch runs at a time. */
let redirectRefreshInFlight: Promise<void> | null = null;

/**
 * Fetch the active redirect map from the backend and replace the cache. A
 * non-OK response leaves the last-known map in place rather than clearing it, so
 * a transient backend hiccup never drops live redirects.
 */
async function refreshRedirectRules(): Promise<void> {
    const response = await fetch(`${getServerSideApiUrl()}/api/redirects`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(REDIRECT_FETCH_TIMEOUT_MS)
    });
    if (!response.ok) {
        return;
    }
    const data = await response.json() as { rules?: RedirectRule[] };
    cachedRedirectRules = Array.isArray(data.rules) ? data.rules : [];
    redirectCacheExpiry = Date.now() + REDIRECT_CACHE_TTL_MS;
}

/**
 * Return the current redirect map, refreshing as needed. On a cold cache it
 * blocks on the first fetch so a redirect fires on the very first request; once
 * warm it serves the cached map immediately and refreshes stale data in the
 * background (deduped), so no request pays fetch latency after warmup. Every
 * failure path degrades to the last-known (or empty) map and lets the request
 * fall through — a redirect lookup must never 500 or stall navigation.
 *
 * @returns The active redirect rules.
 */
async function getRedirectRules(): Promise<RedirectRule[]> {
    const now = Date.now();
    if (redirectCacheExpiry === 0) {
        // Cold: block once so the very first request can still redirect. Arm the
        // expiry either way so subsequent requests take the non-blocking warm
        // path instead of blocking on every hit while a backend is unreachable.
        try {
            await refreshRedirectRules();
        } catch {
            /* leave the map empty; the background path will retry after the TTL */
        }
        if (redirectCacheExpiry === 0) {
            redirectCacheExpiry = now + REDIRECT_CACHE_TTL_MS;
        }
        return cachedRedirectRules;
    }
    if (now >= redirectCacheExpiry && !redirectRefreshInFlight) {
        // Snapshot the stale (already-expired) deadline so the settlement
        // handler can distinguish a successful refresh — which pushes the
        // expiry a full TTL into the future — from a failed one. Both failure
        // modes (a non-OK response, which returns without advancing the
        // expiry, and a thrown fetch caught below) leave the expiry equal to
        // this snapshot. On failure, arm a short backoff so an unhealthy feed
        // is retried once per backoff window instead of re-fetched on every
        // request during a backend incident; the last-known map is retained.
        const staleExpiry = redirectCacheExpiry;
        redirectRefreshInFlight = refreshRedirectRules()
            .catch(() => { /* keep last-known map on failure */ })
            .finally(() => {
                if (redirectCacheExpiry === staleExpiry) {
                    redirectCacheExpiry = Date.now() + REDIRECT_RETRY_BACKOFF_MS;
                }
                redirectRefreshInFlight = null;
            });
    }
    return cachedRedirectRules;
}

/**
 * Check if a referrer URL is from an external domain.
 */
function isExternalReferrer(referer: string, requestHost: string): boolean {
    try {
        const refererUrl = new URL(referer);
        const refererHost = refererUrl.hostname.replace(/^www\./, '');
        const currentHost = requestHost.replace(/^www\./, '');
        return refererHost !== currentHost;
    } catch {
        return false;
    }
}

/**
 * Find a matching redirect rule for the given path.
 *
 * @param pathname - The request path to match.
 * @param rules - The active redirect map (served most-specific-first by the
 *   backend, so the first match under this simple loop is the best one).
 * @returns The matching rule, or undefined when none applies.
 */
function findRedirectRule(pathname: string, rules: RedirectRule[]): RedirectRule | undefined {
    for (const rule of rules) {
        if (rule.isPrefix) {
            if (pathname === rule.pattern || pathname.startsWith(rule.pattern + '/')) {
                return rule;
            }
        } else {
            if (pathname === rule.pattern) {
                return rule;
            }
        }
    }
    return undefined;
}

/**
 * Middleware that handles redirects and sets request context headers.
 */
export async function middleware(request: NextRequest) {
    const pathname = request.nextUrl.pathname;

    // Check for a matching admin-managed redirect rule. The map is fetched from
    // the backend and cached in module scope (see getRedirectRules) — no rules
    // are hardcoded in this bundle.
    const rule = findRedirectRule(pathname, await getRedirectRules());

    if (rule) {
        const referer = request.headers.get('referer');
        const host = request.nextUrl.host;

        // Create redirect response, preserving query string (UTM params, etc.)
        const redirectUrl = new URL(rule.destination, request.url);
        redirectUrl.search = request.nextUrl.search;
        const response = NextResponse.redirect(redirectUrl, rule.permanent ? 301 : 302);

        // Preserve external referrer in cookie
        if (referer && isExternalReferrer(referer, host)) {
            response.cookies.set(ORIGINAL_REFERRER_COOKIE, referer, {
                maxAge: COOKIE_MAX_AGE,
                httpOnly: false,
                sameSite: 'lax',
                path: '/',
            });
        }

        return response;
    }

    // Resolve the analytics traffic id (tid) and first-touch referral
    // capture. Better Auth owns identity now — the middleware mints only the
    // tid, which keys `traffic_events` independently of any login state. The
    // tid is minted whenever it is absent or malformed.
    const existingTid = request.cookies.get(TID_COOKIE_NAME)?.value;
    const tid =
        typeof existingTid === 'string' && UUID_V4_REGEX.test(existingTid)
            ? existingTid
            : crypto.randomUUID();
    const tidMinted = tid !== existingTid;

    const existingRef = request.cookies.get(REF_COOKIE_NAME)?.value;
    const inboundRef = request.nextUrl.searchParams.get('ref');
    const refToSet =
        !existingRef && inboundRef && REFERRAL_CODE_REGEX.test(inboundRef) ? inboundRef : null;
    const referralCode = existingRef ?? refToSet ?? null;

    // Fire the first-touch bootstrap analytics event once per new visitor
    // (i.e. when the tid is freshly minted). Server-to-server, best-effort;
    // the new tid is carried in the body since it is not yet on the request's
    // cookie jar. No identity is minted — this is purely a traffic_events row.
    if (tidMinted) {
        await emitBootstrapEvent(request, tid, referralCode);
    }

    // No redirect - continue with normal request processing
    const response = NextResponse.next({
        request: {
            headers: request.headers
        }
    });

    const isProduction = request.nextUrl.protocol === 'https:';

    // Persist the analytics tid on first sight so every subsequent request —
    // and the backend traffic_events row — keys on a stable id. Set only when
    // freshly minted to avoid a redundant Set-Cookie on every navigation.
    if (tidMinted) {
        response.cookies.set(TID_COOKIE_NAME, tid, {
            httpOnly: true,
            sameSite: 'lax',
            secure: isProduction,
            path: '/',
            maxAge: TID_COOKIE_MAX_AGE_SECONDS
        });
    }

    // Capture the first-touch referral code. First-touch wins: only set
    // when no referral cookie exists yet and the inbound ?ref= is well-formed.
    if (refToSet) {
        response.cookies.set(REF_COOKIE_NAME, refToSet, {
            httpOnly: true,
            sameSite: 'lax',
            secure: isProduction,
            path: '/',
            maxAge: REF_COOKIE_MAX_AGE_SECONDS
        });
    }

    // Set pathname header for widget zone routing
    response.headers.set('x-pathname', pathname);

    return response;
}

/**
 * Middleware matcher configuration.
 *
 * Excludes API routes, static files, and Next.js internals.
 */
export const config = {
    matcher: ['/((?!api|_next/static|_next/image|uploads|favicon.ico|robots.txt|sitemap.xml|llms.txt).*)']
};
