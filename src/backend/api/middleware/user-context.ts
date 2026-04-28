/**
 * User context middleware for plugin routes.
 *
 * Parses the tronrelic_uid cookie and resolves the user via UserService,
 * attaching userId and user to the request object. This middleware runs
 * before plugin route handlers, providing consistent user context access.
 *
 * Plugins can then simply check `req.user` instead of parsing cookies and
 * calling userService directly.
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { UserService } from '../../modules/user/services/user.service.js';
import { logger } from '../../lib/logger.js';
import {
    USER_ID_COOKIE_NAME,
    setIdentityCookie
} from '../../modules/user/api/identity-cookie.js';

/**
 * UUID v4 format regex for validation.
 * Validates format before trusting client-provided cookie values.
 */
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Resolve the visitor's identity UUID from request cookies.
 *
 * Returns `{ userId, signed }` where `signed=true` means the value came from
 * `req.signedCookies` (HMAC-verified by cookie-parser). The legacy
 * `signed=false` path accepts an unsigned UUID v4 from `req.cookies` to
 * preserve continuity for visitors whose cookies were issued before HMAC
 * signing was introduced. Callers can use the flag to decide whether to
 * re-issue the cookie as signed on the response.
 *
 * Returns `null` when no cookie is present or the candidate fails UUID v4
 * format validation. `req.signedCookies[name] === false` (cookie-parser's
 * "tampered" sentinel) is treated as no-cookie — we never honor a forged
 * signed cookie, even on the legacy fallback.
 */
function resolveIdentityFromCookies(req: Request): { userId: string; signed: boolean } | null {
    const signedValue = (req as any).signedCookies?.[USER_ID_COOKIE_NAME];
    if (typeof signedValue === 'string' && UUID_V4_REGEX.test(signedValue)) {
        return { userId: signedValue, signed: true };
    }
    // signedCookies returns `false` on tampered values — never accept those
    // even via the legacy unsigned path; that would defeat HMAC verification.
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
 * Middleware that resolves user context from cookies.
 *
 * Extracts the tronrelic_uid cookie, looks up the user via UserService,
 * and attaches both userId and user to the request object. If no cookie
 * is present or user doesn't exist, the fields remain undefined.
 *
 * This middleware does NOT enforce authentication - it just populates
 * user context. Route handlers decide whether to require authentication.
 *
 * @example
 * ```typescript
 * // In plugin route handler
 * handler: async (req, res) => {
 *     if (!req.user) {
 *         return res.status(401).json({ error: 'Authentication required' });
 *     }
 *     // req.user and req.userId are available
 * }
 * ```
 */
export const userContextMiddleware: RequestHandler = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const resolved = resolveIdentityFromCookies(req);

        if (!resolved) {
            // No user cookie present - continue without user context
            return next();
        }

        const { userId, signed } = resolved;

        // Attach userId to request
        (req as any).userId = userId;

        // Look up user via UserService
        try {
            const userService = UserService.getInstance();
            const user = await userService.getById(userId);

            if (user) {
                (req as any).user = user;
            }
        } catch (error) {
            // UserService may not be initialized yet during startup
            // Log but don't fail the request
            logger.debug(
                { error, userId },
                'Failed to resolve user context (UserService may not be initialized)'
            );
        }

        // Legacy unsigned cookies (issued before HMAC signing) are accepted
        // for visitor identity continuity, but we re-issue the cookie as
        // signed so subsequent requests land on the signed path. The flag
        // stays out of admin auth — `requireAdmin` reads only signedCookies
        // — so this fallback never grants admin access on a forged value.
        if (!signed) {
            try {
                setIdentityCookie(res, userId);
            } catch (error) {
                logger.debug({ error, userId }, 'Failed to re-issue identity cookie as signed');
            }
        }

        next();
    } catch (error) {
        // Don't fail requests due to user context resolution errors
        logger.error({ error }, 'Error in user context middleware');
        next();
    }
};
