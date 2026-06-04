/**
 * @fileoverview Login-gating middleware.
 *
 * The user-level counterpart to `requireAdmin`: admits any caller with
 * a live Better Auth session and 401s anonymous requests. Used by core
 * routers that gate login-only endpoints and pushed automatically onto
 * plugin routes declaring `requiresAuth: true` (see
 * `services/plugin-api.service.ts`).
 *
 * Login is the bar — any authenticated account passes. Routes that
 * operate on a wallet must additionally gate with `hasPrimaryWallet`
 * inside the handler; see `docs/system/system-auth.md`.
 */

import type { NextFunction, Request, Response } from 'express';
import { getSessionForRequest } from '../../modules/identity/services/auth-facade.js';

/**
 * Require the caller to be signed in.
 *
 * Resolves the Better Auth session through the auth facade — a pure
 * cache read when `attachAuthSession` already primed the request, a
 * cookie resolution otherwise (tests, non-Express call sites). The
 * facade degrades resolution failures to `null`, so this middleware
 * never throws: anonymous callers receive 401, authenticated callers
 * proceed with `req.userId` set to the Better Auth user id for audit
 * logging.
 *
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function to pass control to next middleware
 */
export async function requireLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
    const session = await getSessionForRequest(req);
    if (!session) {
        res.status(401).json({ success: false, error: 'Authentication required' });
        return;
    }
    req.userId = session.user.id;
    next();
}
