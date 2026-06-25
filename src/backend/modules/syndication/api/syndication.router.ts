/**
 * @file syndication.router.ts
 *
 * Admin router factory for the syndication operator surface. Admin authentication
 * is applied by the caller at mount time (mirroring the curation and content-
 * router admin surfaces), so this factory stays usable from tests without the
 * auth middleware.
 *
 * @module modules/syndication/api/syndication.router
 */

import { Router } from 'express';
import type { SyndicationController } from './syndication.controller.js';

/**
 * Build the syndication admin router: read stats and the dead-letter queue, and
 * requeue a dead-lettered leg.
 *
 * @param controller - Controller bound to the syndication service.
 * @returns Express router with the operator endpoints.
 */
export function createSyndicationAdminRouter(controller: SyndicationController): Router {
    const router = Router();
    router.get('/stats', controller.getStats);
    router.get('/dead-letter', controller.listDeadLettered);
    router.post('/dead-letter/:legId/retry', controller.retry);

    return router;
}
