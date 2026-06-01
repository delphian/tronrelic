/**
 * @fileoverview Router factories for the public traffic-event ingestion
 * endpoints.
 *
 * Both mount under `/api/user/*`, take no auth (they mint only the unsigned
 * analytics cookies and emit a ClickHouse row), and are rate-limited because
 * each call writes a row:
 * - `POST /api/user/bootstrap` — first-touch `bootstrap`, called by the Next.js
 *   middleware and client/direct callers.
 * - `POST /api/user/track` — `page` navigation, called by the client-side
 *   route-change beacon.
 */

import { Router } from 'express';
import type { BootstrapController } from './bootstrap.controller.js';
import { createRateLimiter } from '../../../api/middleware/rate-limit.js';

/**
 * Create the bootstrap router.
 *
 * @param controller - The traffic ingestion controller.
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

/**
 * Create the page-event router.
 *
 * The ceiling is higher than bootstrap's: the route-change beacon fires once
 * per navigation, and an engaged human can legitimately rack up dozens of
 * page views per minute. It still caps abuse — a runaway client cannot churn
 * the table without bound.
 *
 * @param controller - The traffic ingestion controller.
 * @returns Router exposing `POST /` (mounted at `/api/user/track`).
 */
export function createPageEventRouter(controller: BootstrapController): Router {
    const router = Router();

    const pageRateLimiter = createRateLimiter({
        windowSeconds: 60,
        maxRequests: 60,
        keyPrefix: 'traffic:page'
    });

    router.post('/', pageRateLimiter, controller.page.bind(controller));

    return router;
}
