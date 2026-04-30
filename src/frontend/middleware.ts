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

/** Cookie name for preserved external referrer */
export const ORIGINAL_REFERRER_COOKIE = '_original_ref';

/** Cookie max age in seconds (5 minutes) */
const COOKIE_MAX_AGE = 300;

/**
 * User identity cookie. Server-owned; HttpOnly; one-year max-age. Spec
 * mirrors the backend's `setIdentityCookie` helper. When the request has
 * no cookie, middleware bootstraps it server-to-server so SSR finds an
 * identity on the very first request without redirects or flashes.
 */
const USER_ID_COOKIE_NAME = 'tronrelic_uid';
const USER_ID_COOKIE_MAX_AGE_SECONDS = 31536000;
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    'sec-fetch-site'
] as const;

/** UTM keys we accept from the URL. Anything else is dropped. */
const UTM_KEYS = ['source', 'medium', 'campaign', 'term', 'content'] as const;

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
function buildBootstrapBody(request: NextRequest): string {
    const utm: Record<string, string> = {};
    for (const key of UTM_KEYS) {
        const value = request.nextUrl.searchParams.get(`utm_${key}`);
        if (value) {
            utm[key] = value;
        }
    }

    const originalReferrer = request.cookies.get(ORIGINAL_REFERRER_COOKIE)?.value;

    const payload: Record<string, unknown> = {
        landingPath: request.nextUrl.pathname
    };
    if (Object.keys(utm).length > 0) {
        payload.utm = utm;
    }
    if (originalReferrer) {
        payload.originalReferrer = originalReferrer;
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
 * Mint the identity cookie via the backend's bootstrap endpoint.
 *
 * Resolves to a valid UUID string when the bootstrap call succeeds. Returns
 * null on any failure — middleware must never block page loads on a backend
 * outage; the client-side `UserIdentityProvider` retries on mount.
 *
 * The fetch is server-to-server (within the same Docker network). We
 * intentionally don't forward the inbound request's cookies — there's
 * nothing useful in them when this code path runs (the bootstrap fires
 * only when the identity cookie is absent). We *do* forward the visitor
 * context the backend needs to record a useful `traffic_events` row:
 * client headers (UA, Referer, Sec-CH-UA*, Sec-Fetch-*), the original
 * client IP via `X-Forwarded-For`, and a small JSON body with the
 * landing path, UTM params, and `_original_ref` cookie.
 */
async function bootstrapIdentity(request: NextRequest): Promise<string | null> {
    const backendUrl = process.env.SITE_BACKEND || 'http://localhost:4000';
    try {
        const response = await fetch(`${backendUrl}/api/user/bootstrap`, {
            method: 'POST',
            headers: buildForwardedHeaders(request),
            body: buildBootstrapBody(request),
            // Prevent edge runtime from caching identity bootstrap.
            cache: 'no-store',
            signal: AbortSignal.timeout(3000)
        });
        if (!response.ok) return null;
        const body = (await response.json()) as { id?: unknown };
        if (typeof body?.id !== 'string' || !UUID_V4_REGEX.test(body.id)) {
            return null;
        }
        return body.id;
    } catch {
        return null;
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
 * Legacy redirect rules migrated from next.config.mjs.
 */
const REDIRECT_RULES: RedirectRule[] = [
    // Resource markets legacy paths
    { pattern: '/rent-tron-energy', isPrefix: true, destination: '/resource-markets', permanent: true },
    { pattern: '/lp/rm', isPrefix: true, destination: '/resource-markets', permanent: true },

    // Legacy tool paths
    { pattern: '/tron-trx-energy-fee-calculator', isPrefix: true, destination: '/tools', permanent: true },
    { pattern: '/tools/staking-calculator', isPrefix: true, destination: '/tools', permanent: true },
    { pattern: '/tools/tronmoji', isPrefix: true, destination: '/tools', permanent: true },
    { pattern: '/tools/tron-custom-address-generator', isPrefix: true, destination: '/tools', permanent: true },
    { pattern: '/tools/signature-verification', isPrefix: true, destination: '/tools', permanent: true },
    { pattern: '/tools/hex-to-base58check', isPrefix: true, destination: '/tools', permanent: true },
    { pattern: '/tools/base58check-to-hex', isPrefix: true, destination: '/tools', permanent: true },

    // Legacy article slugs
    { pattern: '/tron-dex', isPrefix: true, destination: '/articles', permanent: true },
    { pattern: '/tron-latest-trc10-tokens', isPrefix: true, destination: '/articles', permanent: true },
    { pattern: '/tron-latest-trc10-exchanges', isPrefix: true, destination: '/articles', permanent: true },
    { pattern: '/tron-node-setup-guide', isPrefix: true, destination: '/articles', permanent: true },
    { pattern: '/tron-bandwidth-vs-energy', isPrefix: true, destination: '/articles', permanent: true },
    { pattern: '/tron-delegated-proof-of-stake', isPrefix: true, destination: '/articles', permanent: true },
    { pattern: '/tron-trc10-token', isPrefix: true, destination: '/articles', permanent: true },
    { pattern: '/tron-super-representatives', isPrefix: true, destination: '/articles', permanent: true },
];

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
 */
function findRedirectRule(pathname: string): RedirectRule | undefined {
    for (const rule of REDIRECT_RULES) {
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

    // Check for matching redirect rule
    const rule = findRedirectRule(pathname);

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

    // Bootstrap the identity cookie on first visit so the SSR pass below
    // (app/layout.tsx → getServerUser) finds a cookie and can prefetch the
    // user record. Without this, brand-new visitors would see a flash on
    // first load while the client-side bootstrap completes after hydration.
    //
    // Skip bootstrap whenever the browser sends *any* non-empty identity
    // cookie:
    //   - Bare UUID (`<uuid>`): legacy unsigned cookie minted before PR
    //     #197 or by this middleware on a prior cookieless visit. The
    //     backend bootstrap accepts it on the next `/api/user/bootstrap`
    //     call and re-anchors as signed.
    //   - Signed envelope (`s:<uuid>.<sig>`): the current server-set
    //     value. The wire format is opaque here — only the backend
    //     holds `SESSION_SECRET` — but its presence proves the visitor
    //     already has a canonical identity. Re-bootstrapping would mint
    //     a fresh UUID and overwrite the signed cookie with an unsigned
    //     one, orphaning the existing user record on every navigation.
    //   - Garbage value: ignored on the middleware side; backend
    //     bootstrap will mint a fresh UUID on the next client-side
    //     bootstrap call when it can't recover a UUID from the cookie.
    //
    // Only mint here when the cookie is genuinely absent or empty. The
    // raw UUID-regex check that used to gate this call rejected the
    // signed envelope and orphaned every returning user post-PR-197.
    const existingId = request.cookies.get(USER_ID_COOKIE_NAME)?.value;
    const needsBootstrap = typeof existingId !== 'string' || existingId.length === 0;

    let injectedUserId: string | null = null;
    if (needsBootstrap) {
        injectedUserId = await bootstrapIdentity(request);
        if (injectedUserId) {
            // Mutate the request's cookie jar so server components running
            // in the same render tree see the cookie via `next/headers`.
            request.cookies.set(USER_ID_COOKIE_NAME, injectedUserId);
        }
        // On bootstrap failure (backend down, edge timeout) we silently
        // continue without a cookie — the client-side provider retries
        // on mount. Better than a redirect loop or a 5xx page.
    }

    // No redirect - continue with normal request processing
    const response = NextResponse.next({
        request: {
            headers: request.headers
        }
    });

    // Persist the bootstrapped identity on the browser so subsequent
    // requests carry it. Spec mirrors the backend's setIdentityCookie:
    // HttpOnly, SameSite=Lax, Secure in production.
    if (injectedUserId) {
        const isProduction = request.nextUrl.protocol === 'https:';
        response.cookies.set(USER_ID_COOKIE_NAME, injectedUserId, {
            httpOnly: true,
            sameSite: 'lax',
            secure: isProduction,
            path: '/',
            maxAge: USER_ID_COOKIE_MAX_AGE_SECONDS
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
    matcher: ['/((?!api|_next/static|_next/image|uploads|favicon.ico|robots.txt|sitemap.xml).*)']
};
