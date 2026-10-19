/**
 * Next.js middleware for request processing.
 *
 * Handles:
 * - Legacy URL redirects with referrer preservation
 * - Language routing: every page request is rewritten into the `[lang]` route
 *   folder, `/markets` to `/en/markets` internally, while `/zh/markets` is
 *   served as Chinese only when that language is enabled and the route is
 *   published in it. With no language enabled every path routes to English,
 *   which is how the site behaved before localization existed.
 * - Custom headers for server components (pathname for widget zone routing)
 *
 * Referrer preservation prevents attribution loss that occurs with static
 * redirects, where the browser overwrites document.referrer with the
 * redirect source URL.
 */

import { NextResponse } from 'next/server';
import type { NextRequest, NextFetchEvent } from 'next/server';
import type { ILocalizationPublicConfig } from '@/types';
import { DEFAULT_LANGUAGE, resolveLocalizedPath } from '@/types';
import { getServerSideApiUrl } from './lib/api-url';
import { createCachedBackendFeed } from './lib/cachedBackendFeed';
import { LANGUAGE_REQUEST_HEADER } from './modules/localization/lib/LANGUAGE_REQUEST_HEADER';
import { CSP_NONCE_HEADER } from './lib/CSP_NONCE_HEADER';
import { buildContentSecurityPolicy } from './lib/buildContentSecurityPolicy';

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
    // address the backend's getClientIP prefers over `req.ip`. These are
    // unverified client-supplied headers a
    // direct-to-origin client can forge, so cf-ray is consistency hygiene,
    // not a trust boundary — the origin firewall allow-listing Cloudflare's
    // ranges is authoritative.
    'cf-ray',
    'cf-ipcountry',
    'cf-connecting-ip',
    // The client's autonomous system number, set by a Cloudflare Transform
    // Rule because Cloudflare sends no ASN header of its own. Mirror of
    // `ASN_HEADER` in the traffic module's `traffic.service.ts` (frontend
    // cannot import backend modules) — keep the two names in sync. Trusted
    // by the backend only alongside `cf-ray`, like `cf-ipcountry`.
    'x-client-asn'
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
 * seeded from `X-Real-IP` when no chain exists). This fetch reaches the
 * backend from inside the Docker network, so without the header the
 * backend would see this container's address for every visitor. With it,
 * Express walks the chain from the right, skips the loopback and
 * private-network hops it trusts, and resolves `req.ip` to the visitor
 * address Nginx added.
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

    // Carry the visitor address through so the backend resolves req.ip to
    // the visitor rather than to this container.
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
 * How long (ms) a fetched feed is served before a background refresh. Matches
 * the backend feeds' Cache-Control, so an admin-added redirect, an enabled
 * language, or a newly published route goes live in at most this long.
 */
const FEED_CACHE_TTL_MS = 60_000;

/**
 * Backoff (ms) applied after a failed warm refresh. Shorter than the healthy
 * TTL so recovery is detected quickly, yet far longer than a single request, so
 * a backend incident costs one feed retry per window rather than one fetch per
 * page view.
 */
const FEED_RETRY_BACKOFF_MS = 10_000;

/**
 * Timeout (ms) for a feed fetch. The feeds sit on the request critical path, so
 * a slow backend must not stall navigation — on timeout the last-known value is
 * used and the request proceeds.
 */
const FEED_FETCH_TIMEOUT_MS = 3000;

/**
 * The admin-managed redirect map. Rules live in Mongo
 * (`module_traffic_redirects`) and are edited from `/system/traffic`; this
 * middleware runs on the Edge runtime and cannot reach Mongo, so it reads the
 * backend's public `/api/redirects` feed. Every failure keeps the last-known
 * (or empty) map, so a redirect lookup never stalls or fails a request.
 */
const getRedirectRules = createCachedBackendFeed<RedirectRule[]>({
    path: '/api/redirects',
    ttlMs: FEED_CACHE_TTL_MS,
    retryBackoffMs: FEED_RETRY_BACKOFF_MS,
    timeoutMs: FEED_FETCH_TIMEOUT_MS,
    initial: [],
    parse: body => {
        const rules = (body as { rules?: unknown })?.rules;
        return Array.isArray(rules) ? rules as RedirectRule[] : [];
    }
});

/**
 * The localization snapshot: which languages are enabled and which routes are
 * published in them, edited at `/system/localization`. Until the first fetch
 * succeeds, and whenever the backend is unreachable on a cold start, it is the
 * English-only snapshot, which routes every request exactly as before
 * localization existed.
 */
const getLocalizationConfig = createCachedBackendFeed<ILocalizationPublicConfig>({
    path: '/api/localization/config',
    ttlMs: FEED_CACHE_TTL_MS,
    retryBackoffMs: FEED_RETRY_BACKOFF_MS,
    timeoutMs: FEED_FETCH_TIMEOUT_MS,
    initial: { defaultLanguage: DEFAULT_LANGUAGE, languages: [], routes: [] },
    parse: body => {
        const snapshot = (body ?? {}) as Partial<ILocalizationPublicConfig>;
        return {
            defaultLanguage: DEFAULT_LANGUAGE,
            languages: Array.isArray(snapshot.languages) ? snapshot.languages : [],
            routes: Array.isArray(snapshot.routes) ? snapshot.routes : []
        };
    }
});

/**
 * Public files the middleware must not rewrite into the `[lang]` folder.
 *
 * Next.js checks the public directory and the root metadata files against the
 * path after the middleware runs, so rewriting `/images/logo.png` to
 * `/en/images/logo.png` would make the file unreachable. Only paths with a file
 * extension under the public folders, plus the root icon routes, are left
 * alone. Anything else, including a missing file under these folders, still
 * ends in the normal 404 page, because the `(site)` layout refuses a request
 * the middleware did not route.
 */
const UNLOCALIZED_PATH_PATTERNS: readonly RegExp[] = [
    /^\/(?:images|plugins)\/.+\.[A-Za-z0-9]+$/,
    /^\/(?:icon|apple-icon)(?:\.[A-Za-z0-9]+)?$/
];

/**
 * Decide whether a path is a public file the middleware must pass through.
 *
 * @param pathname - The request path.
 * @returns True when the path must not be rewritten.
 */
function isUnlocalizedPath(pathname: string): boolean {
    return UNLOCALIZED_PATH_PATTERNS.some(pattern => pattern.test(pathname));
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
 * Beacon a served redirect to the backend so it lands in `redirect_events` for
 * the Redirects-tab analytics.
 *
 * Best-effort and fire-and-forget: the caller fires it on the edge `waitUntil`
 * queue so it never delays the 301/302. It forwards the client headers the
 * backend classifies on (UA, referer, sec-fetch-site, cf-ipcountry) plus the
 * real client IP via `buildForwardedHeaders`, and swallows every failure —
 * analytics must never break a redirect. The target sits under `/api`, excluded
 * by the matcher below, so this never re-enters the middleware.
 *
 * @param request - The inbound request that matched a redirect rule.
 * @param rule - The matched rule; pattern/destination/permanent are recorded as-is.
 */
async function emitRedirectHit(request: NextRequest, rule: RedirectRule): Promise<void> {
    // Resolved outside the try: a missing SITE_BACKEND is a deployment error
    // that must surface, while the fetch below stays best-effort.
    const backendUrl = getServerSideApiUrl();
    try {
        await fetch(`${backendUrl}/api/redirects/hit`, {
            method: 'POST',
            headers: buildForwardedHeaders(request),
            body: JSON.stringify({
                pattern: rule.pattern,
                destination: rule.destination,
                permanent: rule.permanent,
                path: request.nextUrl.pathname
            }),
            cache: 'no-store',
            signal: AbortSignal.timeout(3000)
        });
    } catch {
        // Ignore — redirect analytics is best-effort, never load-bearing.
    }
}

/**
 * Middleware that handles redirects and sets request context headers.
 */
export async function middleware(request: NextRequest, event: NextFetchEvent) {
    const pathname = request.nextUrl.pathname;

    // Both feeds are cached in module scope; after start-up neither costs a
    // backend call on the request path. Fetched together so a cold start waits
    // for one round trip rather than two.
    const [redirectRules, localizationConfig] = await Promise.all([getRedirectRules(), getLocalizationConfig()]);

    // Check for a matching admin-managed redirect rule. No rules are hardcoded
    // in this bundle.
    const rule = findRedirectRule(pathname, redirectRules);

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

        // Record the served redirect for analytics (redirect_events). Queued on
        // waitUntil so the 301/302 returns immediately without waiting on the
        // best-effort beacon.
        event.waitUntil(emitRedirectHit(request, rule));

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

    // No redirect - route the request to its language.
    //
    // The language header is always cleared first, so a value a visitor sends
    // never survives; the layouts trust it only because this line owns it.
    const requestHeaders = new Headers(request.headers);
    requestHeaders.delete(LANGUAGE_REQUEST_HEADER);

    // A fresh nonce per request for the Content-Security-Policy. Next.js reads
    // the nonce from the request's CSP header and stamps it on its own inline
    // scripts; the root layout reads CSP_NONCE_HEADER for the scripts it
    // writes. Next.js checks the enforcing header before the report-only one,
    // so any CSP header a visitor sent is dropped rather than left to supply a
    // nonce of their choosing. The policy is report-only while it is rolled
    // out: browsers report what it would block without blocking anything.
    const nonce = btoa(crypto.randomUUID());
    const contentSecurityPolicy = buildContentSecurityPolicy(nonce, process.env.NODE_ENV === 'development');
    requestHeaders.set(CSP_NONCE_HEADER, nonce);
    requestHeaders.delete('content-security-policy');
    requestHeaders.set('content-security-policy-report-only', contentSecurityPolicy);

    // The path pages and widgets see. For a translated page it drops the
    // language prefix, so widgets and head fragments placed on /markets also
    // apply on /zh/markets.
    let routedPath = pathname;
    let response: NextResponse;
    if (isUnlocalizedPath(pathname)) {
        // A public file: pass it through untouched so Next.js can serve it.
        response = NextResponse.next({ request: { headers: requestHeaders } });
    } else {
        const { language, path } = resolveLocalizedPath(pathname, localizationConfig);
        requestHeaders.set(LANGUAGE_REQUEST_HEADER, language);
        routedPath = path;
        if (language === DEFAULT_LANGUAGE) {
            // English keeps its unprefixed address in the browser and is
            // served from the [lang] folder as `en` internally.
            const target = request.nextUrl.clone();
            target.pathname = pathname === '/' ? `/${DEFAULT_LANGUAGE}` : `/${DEFAULT_LANGUAGE}${pathname}`;
            response = NextResponse.rewrite(target, { request: { headers: requestHeaders } });
        } else {
            // `/zh/markets` already names its [lang] segment; no rewrite needed.
            response = NextResponse.next({ request: { headers: requestHeaders } });
        }
    }

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
    response.headers.set('x-pathname', routedPath);
    response.headers.set('Content-Security-Policy-Report-Only', contentSecurityPolicy);

    return response;
}

/**
 * Middleware matcher configuration.
 *
 * Excludes API routes, static files, and Next.js internals. Also excludes the
 * MCP endpoint and the OAuth discovery documents under `/.well-known/oauth-`,
 * which are rewritten to the backend and are machine-to-machine traffic rather
 * than page views. `/.well-known/security.txt` is excluded too: it is a static
 * file in `public/`, so the `[lang]` rewrite would turn it into a 404, and the
 * scanners that fetch it would otherwise be recorded as visits. Other
 * `/.well-known/` paths still pass through middleware.
 *
 * `images/` covers the static assets in `public/images/`, including the web
 * app manifest at `/images/favicon/manifest.json`. Browsers fetch the manifest
 * without cookies, so letting it through recorded a `bootstrap` row under a
 * freshly minted tid on every page load, one phantom first touch per visit.
 * The trailing slash keeps a page slug that merely starts with "images" routed.
 */
export const config = {
    matcher: ['/((?!api|mcp$|\\.well-known/oauth-|\\.well-known/security\\.txt$|_next/static|_next/image|uploads|images/|favicon.ico|robots.txt|sitemap.xml|llms.txt).*)']
};
