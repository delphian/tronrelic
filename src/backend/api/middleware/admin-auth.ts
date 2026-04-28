import type { NextFunction, Request, Response } from 'express';
import { UserIdentityState, hasFreshVerification } from '@/types';
import { env } from '../../config/env.js';
import { UserService } from '../../modules/user/services/user.service.js';
import { UserGroupService } from '../../modules/user/services/user-group.service.js';
import { USER_ID_COOKIE_NAME } from '../../modules/user/api/identity-cookie.js';

/**
 * Internal failure reasons returned from `tryUserAdminAuth`. Surfaced in
 * the 401 body via `requireAdmin` so the frontend can route the operator
 * to the right recovery flow:
 *
 *   - `'verification_stale'` — user is in the admin group with a verified
 *     wallet, but every wallet's `verifiedAt` is older than the freshness
 *     window. Frontend should prompt re-sign on any attached wallet.
 *   - any other failure (no cookie, malformed cookie, not verified, not
 *     admin, services not initialized) collapses to a generic 401 — those
 *     callers don't need a recovery affordance, they need a verified-admin
 *     account in the first place.
 */
type CookieAdminFailureReason = 'verification_stale' | 'unauthorized';

interface CookieAdminResult {
    userId: string | null;
    reason?: CookieAdminFailureReason;
}

/**
 * Augment Express Request with the admin-auth path that approved the call.
 *
 * `'user'` — request was approved via `tronrelic_uid` cookie + verified
 *            wallet + admin-group membership. `req.userId` identifies the
 *            human operator; audit logs should record it.
 * `'service-token'` — request carried a valid `ADMIN_API_TOKEN`. Used by
 *            CI scripts and the bootstrap-first-admin recipe. No human
 *            attribution; audit logs should record this fact explicitly.
 */
declare module 'express-serve-static-core' {
    interface Request {
        /** Admin auth path that approved the request, set by `requireAdmin`. */
        adminVia?: 'user' | 'service-token';
        /**
         * Cookie-resolved user UUID, populated by `userContextMiddleware`
         * when a valid `tronrelic_uid` cookie is present. Declared here so
         * audit-logging admin handlers can read it without ad-hoc casts.
         */
        userId?: string;
    }
}

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Pull the admin token candidate off a request without enforcing.
 * Accepts the same two transport methods as `requireAdmin`: `x-admin-token`
 * header (preferred) and `Authorization: Bearer {token}`.
 *
 * Returns undefined when no candidate is present.
 */
function extractCandidate(req: Request): string | undefined {
    let candidate: string | undefined;
    const xAdminToken = req.headers['x-admin-token'];
    candidate = Array.isArray(xAdminToken) ? xAdminToken[0] : xAdminToken;

    if (!candidate) {
        const authHeader = req.headers['authorization'];
        const authHeaderStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
        if (authHeaderStr && authHeaderStr.startsWith('Bearer ')) {
            candidate = authHeaderStr.substring(7);
        }
    }

    // Trim and treat the empty string as "no candidate" so transitional
    // frontend code that still sends an `x-admin-token: ''` header (because
    // the localStorage token is gone but the fetch sites haven't been
    // cleaned up) doesn't fail the strict-equality check below.
    if (typeof candidate === 'string') {
        const trimmed = candidate.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }
    return candidate;
}

/**
 * Try to authorize via cookie identity + admin-group membership.
 *
 * Four checks must all pass:
 *   1. `tronrelic_uid` cookie is present and well-formed
 *   2. The resolved user is in `UserIdentityState.Verified` — they have
 *      cryptographically proven control of a wallet, not just a paper
 *      claim. A stolen cookie alone cannot promote a user to admin; the
 *      wallet signature must have actually happened.
 *   3. At least one wallet has `verifiedAt` within the freshness window.
 *      A signature from months ago is no longer load-bearing for admin
 *      authority — the user must re-sign to refresh the freshness clock.
 *      "Any-fresh-wins": one fresh wallet keeps the user fresh-Verified
 *      regardless of how many siblings have gone stale.
 *   4. The user is in the admin group per `IUserGroupService.isAdmin`.
 *
 * Returns the canonical resolved userId on success, or a failure reason
 * the caller can surface to the client. The freshness failure is
 * distinguished from generic unauthorized so the frontend can prompt
 * re-sign instead of rendering the "no admin access" screen for a user
 * who in fact had it five minutes ago.
 *
 * Service singletons are looked up at request time; if they are not yet
 * initialized (test or boot-order edge), the cookie path returns
 * unauthorized cleanly and the caller falls back to the service-token
 * path.
 */
async function tryUserAdminAuth(req: Request): Promise<CookieAdminResult> {
    // Admin auth reads ONLY from signed cookies. cookie-parser populates
    // `req.signedCookies` with the unsigned UUID when the HMAC verifies, or
    // `false` when the signature is forged. Unsigned legacy cookies (still
    // accepted by `userContextMiddleware` during the grace window) are
    // deliberately not honored here — they would defeat the whole point of
    // signing, which is to require server possession of `SESSION_SECRET` to
    // mint a cookie value that passes admin auth.
    const cookieId = (req as any).signedCookies?.[USER_ID_COOKIE_NAME];
    if (typeof cookieId !== 'string' || !UUID_V4_REGEX.test(cookieId)) {
        return { userId: null, reason: 'unauthorized' };
    }

    let userService: UserService;
    let groupService: UserGroupService;
    try {
        userService = UserService.getInstance();
        groupService = UserGroupService.getInstance();
    } catch {
        return { userId: null, reason: 'unauthorized' };
    }

    const user = await userService.getById(cookieId);
    if (!user) return { userId: null, reason: 'unauthorized' };
    if (user.identityState !== UserIdentityState.Verified) {
        return { userId: null, reason: 'unauthorized' };
    }

    const isAdminMember = await groupService.isAdmin(user.id);
    if (!isAdminMember) return { userId: null, reason: 'unauthorized' };

    // Freshness gate fires only after every other identity check passes,
    // so the response cleanly distinguishes "you're not an admin" from
    // "you are an admin but need to re-sign."
    if (!hasFreshVerification(user.wallets)) {
        return { userId: null, reason: 'verification_stale' };
    }

    return { userId: user.id };
}

/**
 * Predicate-style admin check that does not short-circuit the request.
 *
 * Used by handlers that vary their response shape based on caller privilege
 * (e.g., menu read endpoints that hide admin-only namespaces from anonymous
 * visitors) rather than rejecting unauthenticated calls outright. Accepts
 * either the cookie-based admin path or the service-token path.
 *
 * Returns false on any of: ADMIN_API_TOKEN unset and cookie path fails,
 * services not initialized, user not verified, user not in admin group,
 * or the user's verification has gone stale (no wallet `verifiedAt` in
 * the freshness window). Stale-verification predicates collapse to false
 * here on purpose — read endpoints that change shape based on admin
 * status should hide admin affordances from a stale operator the same
 * way they hide them from anyone else, while the dedicated `requireAdmin`
 * middleware surfaces the stale reason for the recovery flow.
 */
export async function isAdmin(req: Request): Promise<boolean> {
    const result = await tryUserAdminAuth(req);
    if (result.userId) return true;
    if (!env.ADMIN_API_TOKEN) return false;
    return extractCandidate(req) === env.ADMIN_API_TOKEN;
}

/**
 * Admin authentication middleware.
 *
 * Two-track authorization:
 *
 *   1. Cookie path (preferred when the caller is a human operator) —
 *      requires `tronrelic_uid` + verified wallet + admin-group
 *      membership. Sets `req.adminVia = 'user'` so audit logs record the
 *      operator's UUID via `req.userId`.
 *
 *   2. Service-token path (CI, scripts, first-admin bootstrap) — requires
 *      a valid `ADMIN_API_TOKEN` via `x-admin-token` header or
 *      `Authorization: Bearer`. Sets `req.adminVia = 'service-token'`.
 *      No per-human attribution; audit logs note the path explicitly.
 *
 * The cookie path is tried first so a request that carries both a valid
 * cookie and a service token is attributed to the human operator.
 *
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function to pass control to next middleware
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        // Prefer the cookie path for per-human attribution.
        const cookieResult = await tryUserAdminAuth(req);
        if (cookieResult.userId) {
            req.adminVia = 'user';
            req.userId = cookieResult.userId;
            next();
            return;
        }

        // Stale verification short-circuits before the service-token
        // fallback. The user *is* an admin — they just need to re-sign.
        // Service-token holders authenticate as themselves, not as the
        // user; falling through would attribute the request to the
        // wrong actor and skip the recovery prompt the frontend needs.
        if (cookieResult.reason === 'verification_stale') {
            res.status(401).json({
                success: false,
                error: 'Unauthorized',
                reason: 'verification_stale'
            });
            return;
        }

        // Fall back to the service token. ADMIN_API_TOKEN unset means the
        // service path is disabled; combined with a failed cookie path
        // this means admin is unreachable, which we surface as 503.
        if (env.ADMIN_API_TOKEN && extractCandidate(req) === env.ADMIN_API_TOKEN) {
            req.adminVia = 'service-token';
            next();
            return;
        }

        if (!env.ADMIN_API_TOKEN) {
            // Shared-token path disabled and no admin user resolved.
            res.status(503).json({ success: false, error: 'Admin API disabled' });
            return;
        }

        res.status(401).json({ success: false, error: 'Unauthorized' });
    } catch {
        // Defensive: never let a thrown error in the auth check leak
        // through to the protected handler. A 500 here means the auth
        // path itself failed (e.g., DB hiccup looking up the user); the
        // caller should retry, not be silently let through.
        res.status(500).json({ success: false, error: 'Auth check failed' });
    }
}
