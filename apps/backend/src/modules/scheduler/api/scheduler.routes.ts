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

/**
 * Create the scheduler admin router.
 *
 * @param controller - Scheduler controller instance
 * @returns Configured Express router
 */
export function createSchedulerRouter(controller: SchedulerController): Router {
    const router = Router();

    // All scheduler admin routes require authentication
    router.use(requireAdmin);

    // GET /status - Get status of all scheduled jobs
    router.get('/status', controller.getStatus);

    // GET /health - Get scheduler health metrics
    router.get('/health', controller.getHealth);

    // PATCH /job/:jobName - Update job configuration
    router.patch('/job/:jobName', controller.updateJob);

    return router;
}
