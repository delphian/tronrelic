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
 * Mint the identity cookie via the backend's bootstrap endpoint.
 *
 * Resolves to a valid UUID string when the bootstrap call succeeds. Returns
 * null on any failure — middleware must never block page loads on a backend
 * outage; the client-side `UserIdentityProvider` retries on mount.
 *
 * The fetch is server-to-server (within the same Docker network), so the
 * empty cookie jar is expected and the backend mints a fresh UUID. We
 * intentionally don't forward the inbound request's cookies — there's
 * nothing useful in them when this code path runs.
 */
async function bootstrapIdentity(): Promise<string | null> {
    const backendUrl = process.env.SITE_BACKEND || 'http://localhost:4000';
    try {
        const response = await fetch(`${backendUrl}/api/user/bootstrap`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
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
    const existingId = request.cookies.get(USER_ID_COOKIE_NAME)?.value;
    const needsBootstrap = !existingId || !UUID_V4_REGEX.test(existingId);

    let injectedUserId: string | null = null;
    if (needsBootstrap) {
        injectedUserId = await bootstrapIdentity();
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
