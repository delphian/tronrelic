/**
 * Router factories for the admin-managed redirect feature.
 *
 * The public router exposes a single read the edge middleware polls; the admin
 * router exposes CRUD. They are separate factories because the module mounts
 * them at different prefixes with different auth: the public feed unauthenticated
 * at `/api/redirects`, the admin CRUD behind `requireAdmin` at `/api/admin/redirects`.
 */

import { Router } from 'express';
import type { RedirectsController } from './redirects.controller.js';
import { createRateLimiter } from '../../../api/middleware/rate-limit.js';

/**
 * Build the public redirect router: the enabled-rules feed the edge middleware
 * polls, plus the hit-ingestion beacon it fires when it serves a redirect.
 *
 * The hit endpoint is rate-limited because each call writes a `redirect_events`
 * row — the same defense the public bootstrap/track ingestion carries. The
 * ceiling is generous: a busy crawler can legitimately trip several legacy URLs
 * a second, and the middleware fires one beacon per served redirect.
 *
 * @param controller - Redirects controller whose read + hit handlers are bound.
 * @returns Router exposing `GET /` and `POST /hit` (mounted at `/api/redirects`).
 */
export function createPublicRedirectsRouter(controller: RedirectsController): Router {
    const router = Router();

    router.get('/', controller.getPublicRedirects.bind(controller));

    const hitRateLimiter = createRateLimiter({
        windowSeconds: 60,
        maxRequests: 60,
        keyPrefix: 'traffic:redirect-hit'
    });
    router.post('/hit', hitRateLimiter, controller.recordHit.bind(controller));

    return router;
}

/**
 * Build the admin redirect-management router. Admin gating is applied by the
 * module at the mount site (`requireAdmin`), matching the traffic/analytics
 * routers, so no per-route auth middleware is declared here.
 *
 * @param controller - Redirects controller whose CRUD handlers are bound.
 * @returns Router exposing list/create/update/delete (mounted at `/api/admin/redirects`).
 */
export function createAdminRedirectsRouter(controller: RedirectsController): Router {
    const router = Router();

    router.get('/', controller.listRedirects.bind(controller));
    router.get('/analytics', controller.getRedirectAnalytics.bind(controller));
    router.post('/', controller.createRedirect.bind(controller));
    router.patch('/:id', controller.updateRedirect.bind(controller));
    router.delete('/:id', controller.deleteRedirect.bind(controller));

    return router;
}
