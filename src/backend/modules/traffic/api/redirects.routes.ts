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

/**
 * Build the public redirect-feed router (the edge middleware's data source).
 *
 * @param controller - Redirects controller whose read handler is bound.
 * @returns Router exposing `GET /` (mounted at `/api/redirects`).
 */
export function createPublicRedirectsRouter(controller: RedirectsController): Router {
    const router = Router();

    router.get('/', controller.getPublicRedirects.bind(controller));

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
    router.post('/', controller.createRedirect.bind(controller));
    router.patch('/:id', controller.updateRedirect.bind(controller));
    router.delete('/:id', controller.deleteRedirect.bind(controller));

    return router;
}
