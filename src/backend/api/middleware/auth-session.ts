/**
 * @fileoverview Better Auth session middleware.
 *
 * Resolves the augmented BA session at the top of the request
 * lifecycle and stores it on `req.authSession` (plus the per-request
 * cache slot the facade uses). Once mounted, every downstream
 * handler — module, plugin, route guard — can call `isLoggedIn(req)`
 * / `isAdmin(req)` / `isInGroup(req, id)` as a pure cache read, with
 * the single Mongo round-trip already amortized in this middleware.
 *
 * **Non-gating.** The middleware never short-circuits a request. An
 * anonymous visitor gets `req.authSession = null` and continues
 * through; an authenticated visitor gets the populated object.
 * Authorization decisions (401, 403, 503) belong to the route
 * handlers and `requireAdmin`, not here.
 *
 * **Error isolation.** A failed session resolution (BA down, Mongo
 * hiccup, malformed cookie) sets `req.authSession = null` and logs
 * the error. The request still proceeds so that anonymous-allowed
 * routes (public reads, the bootstrap endpoint, /api/auth/*) keep
 * working even when the auth tier is degraded.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { logger } from '../../lib/logger.js';
import { getSessionForRequest } from '../../modules/identity/services/auth-facade.js';

const moduleLogger = logger.child({ component: 'auth-session-middleware' });

/**
 * Middleware that resolves the Better Auth session for the request.
 *
 * Calls {@link getSessionForRequest} to populate `req.authSession`
 * (null for anonymous, populated `IAugmentedSession` for logged-in
 * users) and warm the facade's per-request cache. Always calls
 * `next()`; never sends a response.
 *
 * Mount this once, early in the chain, via `app.use(attachAuthSession)`
 * before any route handler that wants to call the facade. The
 * UserModule does this in its `run()` phase before mounting routes.
 */
export const attachAuthSession: RequestHandler = async (
    req: Request,
    _res: Response,
    next: NextFunction
): Promise<void> => {
    // Better Auth's own handler runs on /api/auth/*; it resolves the
    // session internally and never reads req.authSession. Skipping
    // the middleware on those paths avoids a duplicate round-trip for
    // every email-OTP/OAuth/passkey call.
    if (req.path === '/api/auth' || req.path.startsWith('/api/auth/')) {
        next();
        return;
    }
    try {
        const session = await getSessionForRequest(req);
        (req as Request & { authSession?: typeof session }).authSession = session;
    } catch (error) {
        moduleLogger.error({ error, path: req.path }, 'auth-session middleware failed to resolve session');
        (req as Request & { authSession?: null }).authSession = null;
    }
    next();
};
