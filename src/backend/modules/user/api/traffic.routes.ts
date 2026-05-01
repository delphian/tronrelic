import { Router } from 'express';
import type { TrafficController } from './traffic.controller.js';

/**
 * Create Express router for admin traffic-events endpoints.
 *
 * Mounted at `/api/admin/users/traffic` with `requireAdmin` applied at
 * the parent. Mounted BEFORE `/api/admin/users` so the more-specific
 * prefix wins over the `:id` catch — same pattern as
 * `createAdminUserGroupRouter`.
 *
 * The per-user history endpoint lives on the user router under
 * `/api/admin/users/:id/traffic-history`; it shares the controller
 * because the data source is the same and the UUID is a pure URL
 * parameter, not a body shape.
 */
export function createAdminTrafficRouter(controller: TrafficController): Router {
    const router = Router();

    router.get('/summary', controller.getSummary.bind(controller));
    router.get('/top-paths', controller.getTopPaths.bind(controller));
    router.get('/top-countries', controller.getTopCountries.bind(controller));
    router.get('/bot-other-samples', controller.getBotOtherSamples.bind(controller));

    return router;
}
