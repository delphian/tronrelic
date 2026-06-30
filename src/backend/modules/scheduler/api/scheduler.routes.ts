/**
 * @fileoverview Express router for scheduler admin API endpoints.
 *
 * Mounts scheduler management endpoints under /api/admin/system/scheduler.
 * All endpoints require admin authentication.
 *
 * @module modules/scheduler/api/scheduler.routes
 */

import { Router } from 'express';
import type { SchedulerController } from './scheduler.controller.js';
import { requireAdmin } from '../../../api/middleware/admin-auth.js';
import { createAdminRateLimiter } from '../../../api/middleware/rate-limit.js';

/**
 * Create the scheduler admin router.
 *
 * @param controller - Scheduler controller instance
 * @returns Configured Express router
 */
export function createSchedulerRouter(controller: SchedulerController): Router {
    const router = Router();

    // All scheduler admin routes are rate-limited and require authentication.
    // Rate limiting runs first so it bounds the brute-force cost against the
    // auth gate itself.
    router.use(createAdminRateLimiter('scheduler-admin'));
    router.use(requireAdmin);

    // GET /status - Get status of all scheduled jobs
    router.get('/status', controller.getStatus);

    // GET /health - Get scheduler health metrics
    router.get('/health', controller.getHealth);

    // PATCH /job/:jobName - Update job configuration
    router.patch('/job/:jobName', controller.updateJob);

    // POST /job/:jobName/run - Trigger a job immediately, outside its schedule
    router.post('/job/:jobName/run', controller.runJob);

    return router;
}
