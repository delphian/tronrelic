/**
 * @fileoverview Router factories for the connected-apps self-service surface.
 *
 * Two routers: `/api/user/connected-apps` (list and revoke the caller's
 * grants) and `/api/user/oauth` (the consent screen's context lookup). Both
 * resolve the caller from the Better Auth session inside the controller and
 * carry no user id in the path.
 */

import { Router } from 'express';
import type { ConnectedAppsController } from './connected-apps.controller.js';
import { asyncHandler } from '../../../api/middleware/async-handler.js';
import { createRateLimiter } from '../../../api/middleware/rate-limit.js';

/**
 * Create the router mounted at `/api/user/connected-apps`.
 *
 * @param controller - The connected-apps controller.
 * @returns The configured router.
 */
export function createConnectedAppsRouter(controller: ConnectedAppsController): Router {
    const router = Router();
    const limiter = createRateLimiter({ windowSeconds: 60, maxRequests: 30, keyPrefix: 'user:connected-apps' });

    /** GET /api/user/connected-apps — the caller's connected apps. */
    router.get('/', limiter, asyncHandler(controller.list));

    /** DELETE /api/user/connected-apps?clientId=... — revoke one of them. */
    router.delete('/', limiter, asyncHandler(controller.revoke));

    return router;
}

/**
 * Create the router mounted at `/api/user/oauth`.
 *
 * The context lookup can make the server fetch a client metadata document, so
 * it is rate-limited more tightly than ordinary reads.
 *
 * @param controller - The connected-apps controller.
 * @returns The configured router.
 */
export function createOAuthConsentRouter(controller: ConnectedAppsController): Router {
    const router = Router();
    const limiter = createRateLimiter({ windowSeconds: 60, maxRequests: 20, keyPrefix: 'user:oauth-consent' });

    /** GET /api/user/oauth/authorize-context — details for the consent screen. */
    router.get('/authorize-context', limiter, asyncHandler(controller.authorizeContext));

    return router;
}
