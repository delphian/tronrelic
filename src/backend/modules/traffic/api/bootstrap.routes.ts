/**
 * @fileoverview Router factory for the slim analytics bootstrap endpoint.
 *
 * Mounts `POST /api/user/bootstrap` — the first-touch `traffic_events` entry
 * point called by the Next.js middleware and client/direct callers. No auth:
 * the endpoint mints only the unsigned analytics cookies and emits a ClickHouse
 * row. Rate-limited because each call records an event.
 */

import { Router } from 'express';
import type { BootstrapController } from './bootstrap.controller.js';
import { createRateLimiter } from '../../../api/middleware/rate-limit.js';

/**
 * Create the bootstrap router.
 *
 * @param controller - The bootstrap controller.
 * @returns Router exposing `POST /` (mounted at `/api/user/bootstrap`).
 */
export function createBootstrapRouter(controller: BootstrapController): Router {
    const router = Router();

    // Slightly tighter than the analytics reads — each call writes a row, and
    // an attacker hammering it would churn the traffic_events table.
    const bootstrapRateLimiter = createRateLimiter({
        windowSeconds: 60,
        maxRequests: 10,
        keyPrefix: 'traffic:bootstrap'
    });

    router.post('/', bootstrapRateLimiter, controller.bootstrap.bind(controller));

    return router;
}
