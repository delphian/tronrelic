/**
 * @fileoverview Canonical specification for the user identity cookie.
 *
 * The server is the only writer of `tronrelic_uid`. The cookie is HttpOnly
 * so JavaScript cannot read or exfiltrate it via XSS, and the value is a
 * UUID v4 minted server-side at the bootstrap endpoint. Centralizing the
 * spec here prevents drift between the bootstrap controller, future
 * middleware-side cookie refreshes, and tests asserting cookie shape.
 */

import type { Response } from 'express';

/** Cookie name for user identity. */
export const USER_ID_COOKIE_NAME = 'tronrelic_uid';

/** Max age in seconds (1 year). */
export const USER_ID_COOKIE_MAX_AGE_SECONDS = 31536000;

/**
 * Express cookie options for the identity cookie.
 *
 * `httpOnly: true` is the load-bearing flag: it removes the cookie from
 * `document.cookie`, so an XSS payload cannot read or steal the UUID.
 * `sameSite: 'lax'` blocks the cookie on cross-site POST while permitting
 * normal navigation. `secure` is true in production (HTTPS-only).
 *
 * @param isProduction - Whether to set the Secure flag (HTTPS-only)
 * @returns Cookie options ready to pass to `res.cookie(name, value, options)`
 */
export function buildIdentityCookieOptions(isProduction: boolean) {
    return {
        httpOnly: true,
        sameSite: 'lax' as const,
        secure: isProduction,
        path: '/',
        maxAge: USER_ID_COOKIE_MAX_AGE_SECONDS * 1000
    };
}

/**
 * Set the identity cookie on an Express response.
 *
 * Helper used by the bootstrap endpoint. Picks `secure: true` automatically
 * when running under NODE_ENV=production. Tests can opt into the Secure
 * flag explicitly via the `secure` parameter.
 *
 * @param res - Express response to attach the Set-Cookie header to
 * @param userId - UUID v4 the server has minted for this visitor
 * @param secure - Override Secure flag; defaults to NODE_ENV === 'production'
 */
export function setIdentityCookie(res: Response, userId: string, secure?: boolean): void {
    const isProduction = secure ?? process.env.NODE_ENV === 'production';
    res.cookie(USER_ID_COOKIE_NAME, userId, buildIdentityCookieOptions(isProduction));
}
