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
import { asyncHandler } from '../../../api/middleware/async-handler.js';

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

    router.get('/curations', asyncHandler(controller.listCurations));
    router.get('/curations/count', asyncHandler(controller.getCurationsCount));
    router.get('/curations/history', asyncHandler(controller.listCurationHistory));
    router.get('/curations/:id/destinations', asyncHandler(controller.listDestinations));
    router.post('/curations/:id/destinations/defaults', asyncHandler(controller.setDestinationDefaults));
    router.patch('/curations/:id', asyncHandler(controller.editCuration));
    router.post('/curations/:id/approve', asyncHandler(controller.approveCuration));
    router.post('/curations/:id/reject', asyncHandler(controller.rejectCuration));

    return router;
}
