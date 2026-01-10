import type { NextFunction, Request, Response } from 'express';
import { env } from '../../config/env.js';

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

    // Try x-admin-token header first
    let candidate: string | undefined;
    const xAdminToken = req.headers['x-admin-token'];
    candidate = Array.isArray(xAdminToken) ? xAdminToken[0] : xAdminToken;

    // Try Authorization: Bearer {token} header
    if (!candidate) {
        const authHeader = req.headers['authorization'];
        const authHeaderStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
        if (authHeaderStr && authHeaderStr.startsWith('Bearer ')) {
            candidate = authHeaderStr.substring(7);
        }
    }

    // Query parameter authentication removed for security (tokens in URLs are logged
    // in server access logs, browser history, and sent in Referer headers to external sites)

    if (candidate !== env.ADMIN_API_TOKEN) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
    }

    next();
}
