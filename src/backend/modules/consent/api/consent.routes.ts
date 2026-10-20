/**
 * @fileoverview Router factories for the consent module.
 *
 * Two routers because they mount at different prefixes with different
 * protection: the public config and the page-view counter at `/api/consent`,
 * and the management API behind `requireAdmin` at `/api/admin/system/consent`.
 * Admin gating and its rate limiter are applied by the module at the mount
 * site, matching the other modules.
 */

import { Router } from 'express';
import { createRateLimiter } from '../../../api/middleware/rate-limit.js';
import type { ConsentPublicController } from './consent-public.controller.js';
import type { ConsentAdminController } from './consent-admin.controller.js';

/**
 * Build the public router.
 *
 * The page-view route is limited per visitor address. A person browsing
 * views a few pages a minute, so sixty leaves room for anyone reading quickly
 * and stops one client from inflating the count.
 *
 * @param controller - Public handlers.
 * @returns Router exposing `GET /config` and `POST /pageviews`.
 */
export function createConsentPublicRouter(controller: ConsentPublicController): Router {
    const router = Router();
    router.get('/config', controller.getConfig);
    router.post(
        '/pageviews',
        createRateLimiter({ windowSeconds: 60, maxRequests: 60, keyPrefix: 'consent-pageviews' }),
        controller.postPageview
    );
    return router;
}

/**
 * Build the admin router.
 *
 * @param controller - Admin handlers.
 * @returns Router exposing the settings, renew, and page view endpoints.
 */
export function createConsentAdminRouter(controller: ConsentAdminController): Router {
    const router = Router();
    router.get('/settings', controller.getSettings);
    router.patch('/settings', controller.updateSettings);
    router.post('/settings/renew', controller.renewConsent);
    router.get('/pageviews', controller.getPageviewStats);
    return router;
}
