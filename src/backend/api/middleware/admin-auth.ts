import type { NextFunction, Request, Response } from 'express';
import { env } from '../../config/env.js';
import {
    getSessionForRequest,
    isAdmin as facadeIsAdmin
} from '../../modules/identity/services/auth-facade.js';

/**
 * Augment Express Request with the admin-auth path that approved the call.
 *
 * `'user'` — request was approved via a Better Auth session whose user is a
 *            member of the `admin` group. `req.userId` carries that BA user
 *            id; audit logs should record it.
 * `'service-token'` — request carried a valid `ADMIN_API_TOKEN`. Used by CI
 *            scripts and the bootstrap-first-admin recipe. No human
 *            attribution; audit logs note this fact explicitly.
 */
declare module 'express-serve-static-core' {
    interface Request {
        /** Admin auth path that approved the request, set by `requireAdmin`. */
        adminVia?: 'user' | 'service-token';
        /**
         * Better Auth user id of the admin operator, populated by
         * `requireAdmin` on the session path. Declared here so audit-logging
         * admin handlers can read it without ad-hoc casts.
         */
        userId?: string;
    }
}

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

    // Trim and treat the empty string as "no candidate" so a stray
    // `x-admin-token: ''` header doesn't fail the strict-equality check below.
    if (typeof candidate === 'string') {
        const trimmed = candidate.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }
    return candidate;
}

/**
 * Predicate-style admin check that does not short-circuit the request.
 *
 * Used by handlers that vary their response shape based on caller privilege
 * (e.g., menu read endpoints that hide admin-only entries from non-admin
 * visitors) rather than rejecting unauthenticated calls outright. Accepts
 * either a Better Auth admin session or the service-token path.
 *
 * Returns false when the caller has no admin session and either
 * `ADMIN_API_TOKEN` is unset or the presented token does not match.
 */
export async function isAdmin(req: Request): Promise<boolean> {
    try {
        if (await facadeIsAdmin(req)) {
            return true;
        }
    } catch {
        // Facade not configured in this test/boot context — fall through
        // to the service-token check rather than failing the predicate.
    }
    if (!env.ADMIN_API_TOKEN) return false;
    return extractCandidate(req) === env.ADMIN_API_TOKEN;
}

/**
 * Admin authentication middleware.
 *
 * Two-track authorization:
 *
 *   1. Better Auth session path (human operators) — requires a live BA
 *      session whose user is in the `admin` group. Sets
 *      `req.adminVia = 'user'` and `req.userId` to the BA user id so audit
 *      logs attribute the action to the operator.
 *
 *   2. Service-token path (CI, scripts, first-admin bootstrap) — requires a
 *      valid `ADMIN_API_TOKEN` via `x-admin-token` header or
 *      `Authorization: Bearer`. Sets `req.adminVia = 'service-token'`. No
 *      per-human attribution; audit logs note the path explicitly.
 *
 * The session path is tried first so a request carrying both a valid session
 * and a service token is attributed to the human operator.
 *
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function to pass control to next middleware
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        // Better Auth session + admin-group membership. Resolved through the
        // facade so the single-surface authorization rule holds.
        let adminUserId: string | null = null;
        try {
            if (await facadeIsAdmin(req)) {
                const session = await getSessionForRequest(req);
                adminUserId = session?.user.id ?? null;
            }
        } catch {
            adminUserId = null;
        }
        if (adminUserId) {
            req.adminVia = 'user';
            req.userId = adminUserId;
            next();
            return;
        }

        // Fall back to the service token. ADMIN_API_TOKEN unset means the
        // service path is disabled; combined with no admin session this means
        // admin is unreachable, which we surface as 503.
        if (env.ADMIN_API_TOKEN && extractCandidate(req) === env.ADMIN_API_TOKEN) {
            req.adminVia = 'service-token';
            next();
            return;
        }

        if (!env.ADMIN_API_TOKEN) {
            res.status(503).json({ success: false, error: 'Admin API disabled' });
            return;
        }

        res.status(401).json({ success: false, error: 'Unauthorized' });
    } catch {
        // Defensive: never let a thrown error in the auth check leak through
        // to the protected handler.
        res.status(500).json({ success: false, error: 'Auth check failed' });
    }
}
