/**
 * @file curation.router.ts
 *
 * Express router for the central curation admin API, mounted at
 * `/api/admin/system/curation`. Every endpoint is rate-limited and requires
 * admin authentication — the rate limiter runs first so it bounds the
 * brute-force cost against the auth gate itself, matching the other admin
 * surfaces.
 */

import { Router } from 'express';
import type { CurationController } from './curation.controller.js';
import { requireAdmin } from '../../../api/middleware/admin-auth.js';
import { createAdminRateLimiter } from '../../../api/middleware/rate-limit.js';

/**
 * Build the curation admin router.
 *
 * @param controller - The controller whose handlers back each route.
 * @returns The configured router.
 */
export function createCurationAdminRouter(controller: CurationController): Router {
    const router = Router();

    router.use(createAdminRateLimiter('curation-admin'));
    router.use(requireAdmin);

    router.get('/curations', controller.listCurations);
    router.get('/curations/count', controller.getCurationsCount);
    router.get('/curations/history', controller.listCurationHistory);
    router.get('/curations/:id/destinations', controller.listDestinations);
    router.post('/curations/:id/destinations/defaults', controller.setDestinationDefaults);
    router.patch('/curations/:id', controller.editCuration);
    router.post('/curations/:id/approve', controller.approveCuration);
    router.post('/curations/:id/reject', controller.rejectCuration);

    return router;
}
