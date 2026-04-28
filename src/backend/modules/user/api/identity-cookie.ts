/**
 * @fileoverview Canonical specification for the user identity cookie.
 *
 * The server is the only writer of `tronrelic_uid`. The cookie is HttpOnly
 * so JavaScript cannot read or exfiltrate it via XSS, and the value is a
 * UUID v4 minted server-side at the bootstrap endpoint. Since PR #197
 * follow-up the cookie value is HMAC-signed with `SESSION_SECRET` via
 * cookie-parser, so a non-browser client cannot forge a `tronrelic_uid`
 * header by guessing or learning a UUID — the signature must verify with a
 * secret the server holds. Centralizing the spec here prevents drift
 * between the bootstrap controller, identity-swap rewrites in the
 * link-wallet handler, and tests asserting cookie shape.
 */

import type { Request, Response } from 'express';

/** Cookie name for user identity. */
export const USER_ID_COOKIE_NAME = 'tronrelic_uid';

/** Max age in seconds (1 year). */
export const USER_ID_COOKIE_MAX_AGE_SECONDS = 31536000;

/**
 * UUID v4 regex used by every identity reader. Centralized here so the
 * auth/authz code paths (`requireAdmin`, `userContextMiddleware`, the
 * bootstrap and `validateCookie` controllers, the websocket handshake
 * parser, and the frontend bootstrap response check) share a single
 * source of truth and cannot drift.
 */
export const UUID_V4_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Result of resolving the visitor's UUID from cookie-parser output.
 *
 * `signed: true` means the value came from `req.signedCookies` after
 * HMAC verification. `signed: false` means it came from `req.cookies`
 * as a legacy unsigned UUID — callers that re-issue cookies (bootstrap,
 * validateCookie, userContextMiddleware) use this flag to upgrade
 * legacy holders by calling `setIdentityCookie`. The strict admin
 * gate deliberately does *not* use this helper — it must reject
 * unsigned values outright, not upgrade them.
 */
export interface IResolvedIdentity {
    userId: string;
    signed: boolean;
}

/**
 * Resolve the visitor's UUID from cookie-parser-populated request fields,
 * applying the canonical signed-first / unsigned-fallback policy.
 *
 * Returns null when:
 *   - No identity cookie is present.
 *   - The signed envelope's HMAC failed verification (cookie-parser
 *     surfaces this as `req.signedCookies[name] === false`). We never
 *     fall back to the unsigned bag in this case — accepting a forged
 *     value via the legacy path would defeat the point of signing.
 *   - Both cookie sources carry malformed (non-UUID-v4) values.
 *
 * The signed-first preference avoids ambiguity during the brief window
 * after the backend re-issued a cookie as signed but the legacy
 * unsigned cookie hasn't been overwritten yet.
 *
 * @param req - Express request populated by cookie-parser
 * @returns Resolved UUID + signedness, or null
 */
export function resolveIdentityFromCookies(req: Request): IResolvedIdentity | null {
    const signedValue = (req as any).signedCookies?.[USER_ID_COOKIE_NAME];
    if (typeof signedValue === 'string' && UUID_V4_REGEX.test(signedValue)) {
        return { userId: signedValue, signed: true };
    }
    // Forged signed cookies surface as `false`. Refuse the legacy
    // unsigned fallback in this case — that would defeat HMAC.
    if (signedValue === false) {
        return null;
    }
    const unsignedValue = (req as any).cookies?.[USER_ID_COOKIE_NAME];
    if (typeof unsignedValue === 'string' && UUID_V4_REGEX.test(unsignedValue)) {
        return { userId: unsignedValue, signed: false };
    }
    return null;
}

/**
 * Express cookie options for the identity cookie.
 *
 * `httpOnly: true` is the load-bearing flag against XSS exfiltration.
 * `signed: true` opts the cookie into HMAC signing by cookie-parser using
 * the secret passed to `cookieParser(secret)` in the Express loader; the
 * on-the-wire value becomes `s:<uuid>.<HMAC>` and forged cookies fail
 * verification on read. `sameSite: 'lax'` blocks the cookie on cross-site
 * POST while permitting normal navigation. `secure` is true in production
 * (HTTPS-only).
 *
 * @param isProduction - Whether to set the Secure flag (HTTPS-only)
 * @returns Cookie options ready to pass to `res.cookie(name, value, options)`
 */
export function buildIdentityCookieOptions(isProduction: boolean) {
    return {
        httpOnly: true,
        signed: true,
        sameSite: 'lax' as const,
        secure: isProduction,
        path: '/',
        maxAge: USER_ID_COOKIE_MAX_AGE_SECONDS * 1000
    };
}

/**
 * Set the identity cookie on an Express response.
 *
 * Helper used by the bootstrap endpoint and the link-wallet identity-swap
 * branch. Picks `secure: true` automatically when running under
 * NODE_ENV=production. Tests can opt into the Secure flag explicitly via
 * the `secure` parameter. Always emits a signed cookie because
 * `buildIdentityCookieOptions` sets `signed: true`.
 *
 * @param res - Express response to attach the Set-Cookie header to
 * @param userId - UUID v4 the server has minted for this visitor
 * @param secure - Override Secure flag; defaults to NODE_ENV === 'production'
 */
export function setIdentityCookie(res: Response, userId: string, secure?: boolean): void {
    const isProduction = secure ?? process.env.NODE_ENV === 'production';
    res.cookie(USER_ID_COOKIE_NAME, userId, buildIdentityCookieOptions(isProduction));
}
