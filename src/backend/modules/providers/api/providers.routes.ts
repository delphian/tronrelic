/**
 * @fileoverview Router for the external-providers admin API.
 *
 * Mounts the TronScan config read/write/test endpoints under
 * `/api/admin/system/providers`. The module applies the admin rate limiter and
 * `requireAdmin` at mount time, so this factory only wires paths to handlers.
 */

import { Router } from 'express';
import type { ProvidersController } from './providers.controller.js';

/**
 * Build the providers admin router.
 *
 * @param controller - Providers controller instance.
 * @returns Configured Express router.
 */
export function createProvidersRouter(controller: ProvidersController): Router {
    const router = Router();

    // GET /tronscan - masked config for the admin form
    router.get('/tronscan', controller.getTronScanConfig);

    // PUT /tronscan - persist config changes (key sanitised in the controller)
    router.put('/tronscan', controller.updateTronScanConfig);

    // POST /tronscan/test - live connectivity/credential check
    router.post('/tronscan/test', controller.testTronScan);

    return router;
}
