/**
 * @fileoverview Analytics (`tronrelic_tid`) and referral (`tronrelic_ref`)
 * cookie specs and helpers.
 *
 * These cookies decouple behavioral analytics from identity. Better Auth
 * owns identity; analytics keeps its own independent visitor key,
 * `tronrelic_tid`, so the `traffic_events` store never depends on the
 * identity layer.
 *
 * **`tronrelic_tid` (traffic id).** A server-minted UUID v4 that keys every
 * `traffic_events` row regardless of auth state. It confers no identity or
 * authorization — forging it only pollutes one's own analytics bucket — so it
 * is deliberately *unsigned*. HttpOnly keeps it out of client JS; the value is
 * a UUID so it slots into the `traffic_events.candidate_uid` `UUID` column
 * without a schema change.
 *
 * **`tronrelic_ref` (referral).** First-touch capture of an inbound
 * `?ref=<code>` so a later signup can attribute to the referrer. Set once
 * (first-touch wins) and read at conversion time. Also unsigned — the value is
 * a public referral code.
 *
 * Both cookies are written by the Next.js middleware (SSR-first path) and the
 * backend bootstrap endpoint (client/direct callers); see the traffic bootstrap
 * controller and `src/frontend/middleware.ts`.
 */

import type { Request, Response } from 'express';

/**
 * UUID v4 format guard. Inlined here (rather than shared with the retired
 * identity-cookie module) so the traffic module owns its own validation.
 */
export const UUID_V4_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Cookie name for the analytics traffic id. */
export const TID_COOKIE_NAME = 'tronrelic_tid';

/** Cookie name for the captured referral code. */
export const REF_COOKIE_NAME = 'tronrelic_ref';

/** Traffic-id cookie max age in seconds (1 year). */
export const TID_COOKIE_MAX_AGE_SECONDS = 31536000;

/** Referral cookie max age in seconds (90 days) — the attribution window. */
export const REF_COOKIE_MAX_AGE_SECONDS = 7776000;

/**
 * Accepted shape for a referral code: 4–32 chars of alphanumerics, dash,
 * or underscore. Generous enough for any minted code while rejecting a
 * crafted multi-KB `?ref=` value before it reaches a cookie or a ClickHouse
 * row.
 */
export const REFERRAL_CODE_REGEX = /^[A-Za-z0-9_-]{4,32}$/;

/**
 * Resolve the visitor's analytics traffic id from the request cookies.
 *
 * Unsigned — read straight from `req.cookies`. Returns `null` when absent or
 * malformed so callers mint a fresh one.
 *
 * @param req - Express request populated by cookie-parser.
 * @returns Validated UUID v4 traffic id, or `null`.
 */
export function resolveTid(req: Request): string | null {
    const value = (req as unknown as { cookies?: Record<string, unknown> }).cookies?.[TID_COOKIE_NAME];
    if (typeof value === 'string' && UUID_V4_REGEX.test(value)) {
        return value;
    }
    return null;
}

/**
 * Resolve the captured referral code from the request cookies.
 *
 * @param req - Express request populated by cookie-parser.
 * @returns Validated referral code, or `null`.
 */
export function resolveRef(req: Request): string | null {
    const value = (req as unknown as { cookies?: Record<string, unknown> }).cookies?.[REF_COOKIE_NAME];
    return normalizeReferralCode(value);
}

/**
 * Validate and normalize an arbitrary value into a referral code.
 *
 * Used to vet both the cookie value and an inbound `?ref=` / forwarded body
 * value before it is trusted. Returns `null` for anything that is not a
 * well-formed code.
 *
 * @param raw - Untrusted candidate value.
 * @returns The code when it matches {@link REFERRAL_CODE_REGEX}, else `null`.
 */
export function normalizeReferralCode(raw: unknown): string | null {
    if (typeof raw === 'string' && REFERRAL_CODE_REGEX.test(raw)) {
        return raw;
    }
    return null;
}

/**
 * Express cookie options shared by both traffic cookies.
 *
 * `httpOnly` keeps the value out of client JS. `signed: false` is deliberate —
 * neither cookie confers identity or authorization.
 *
 * @param maxAgeSeconds - Cookie lifetime.
 * @param isProduction - Whether to set the Secure (HTTPS-only) flag.
 * @returns Options for `res.cookie(...)`.
 */
function buildCookieOptions(maxAgeSeconds: number, isProduction: boolean) {
    return {
        httpOnly: true,
        signed: false,
        sameSite: 'lax' as const,
        secure: isProduction,
        path: '/',
        maxAge: maxAgeSeconds * 1000
    };
}

/**
 * Set the analytics traffic-id cookie on a response.
 *
 * @param res - Express response.
 * @param tid - UUID v4 traffic id.
 * @param secure - Override Secure flag; defaults to `NODE_ENV === 'production'`.
 */
export function setTidCookie(res: Response, tid: string, secure?: boolean): void {
    const isProduction = secure ?? process.env.NODE_ENV === 'production';
    res.cookie(TID_COOKIE_NAME, tid, buildCookieOptions(TID_COOKIE_MAX_AGE_SECONDS, isProduction));
}

/**
 * Set the referral cookie on a response.
 *
 * @param res - Express response.
 * @param code - Validated referral code.
 * @param secure - Override Secure flag; defaults to `NODE_ENV === 'production'`.
 */
export function setRefCookie(res: Response, code: string, secure?: boolean): void {
    const isProduction = secure ?? process.env.NODE_ENV === 'production';
    res.cookie(REF_COOKIE_NAME, code, buildCookieOptions(REF_COOKIE_MAX_AGE_SECONDS, isProduction));
}
