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

/**
 * Parse cookies from request Cookie header.
 *
 * Express's cookie-parser middleware may not be available on all routes,
 * so we manually parse the Cookie header for reliability.
 *
 * @param req - Express request object
 * @returns Parsed cookies as key-value pairs
 */
function parseCookies(req: Request): Record<string, string> {
    // If Express cookie-parser is available, use it
    if (req.cookies && typeof req.cookies === 'object') {
        return req.cookies;
    }

    // Otherwise parse from header
    const cookieHeader = req.headers.cookie || '';
    if (!cookieHeader) {
        return {};
    }

    const cookies: Record<string, string> = {};
    cookieHeader.split(';').forEach(cookie => {
        const [name, ...rest] = cookie.trim().split('=');
        if (name) {
            cookies[name] = rest.join('=');
        }
    });
    return cookies;
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
        const cookies = parseCookies(req);
        const userId = cookies['tronrelic_uid'];

        if (!userId) {
            // No user cookie present - continue without user context
            return next();
        }

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

        next();
    } catch (error) {
        // Don't fail requests due to user context resolution errors
        logger.error({ error }, 'Error in user context middleware');
        next();
    }
};
