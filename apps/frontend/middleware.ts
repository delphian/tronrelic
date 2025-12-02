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
export function middleware(request: NextRequest) {
    const pathname = request.nextUrl.pathname;

    // Check for matching redirect rule
    const rule = findRedirectRule(pathname);

    if (rule) {
        const referer = request.headers.get('referer');
        const host = request.headers.get('host') || '';

        // Create redirect response
        const redirectUrl = new URL(rule.destination, request.url);
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

    // No redirect - continue with normal request processing
    const response = NextResponse.next();

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
