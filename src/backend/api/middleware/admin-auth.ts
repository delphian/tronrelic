import type { NextFunction, Request, Response } from 'express';
import { env } from '../../config/env.js';

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

    return candidate;
}

/**
 * Predicate-style admin check that does not short-circuit the request.
 * Used by handlers that vary their response shape based on caller privilege
 * (e.g., menu read endpoints that hide admin-only namespaces from anonymous
 * visitors) rather than rejecting unauthenticated calls outright.
 *
 * Returns false when ADMIN_API_TOKEN is unset — the API is then effectively
 * locked, and all gated paths fall through to the public response.
 */
export function isAdmin(req: Request): boolean {
    if (!env.ADMIN_API_TOKEN) return false;
    return extractCandidate(req) === env.ADMIN_API_TOKEN;
}

/**
 * Admin authentication middleware.
 *
 * Validates admin access using ADMIN_API_TOKEN from environment. Query parameter
 * authentication is intentionally not supported for security reasons (tokens in URLs
 * are logged, visible in browser history, and sent in Referer headers).
 *
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function to pass control to next middleware
 *
 * Supported authentication methods:
 * - x-admin-token header (recommended)
 * - Authorization: Bearer {token} header
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
    if (!env.ADMIN_API_TOKEN) {
        res.status(503).json({ success: false, error: 'Admin API disabled' });
        return;
    }

    if (extractCandidate(req) !== env.ADMIN_API_TOKEN) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
    }

    next();
}
