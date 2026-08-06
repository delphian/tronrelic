/**
 * @fileoverview Router for the external-providers admin API.
 *
 * Mounts the per-provider config endpoints under `/api/admin/system/providers`:
 * read/write/test for TronScan, and read/write/test plus the two key-pool
 * operations for TronGrid. The module applies the admin rate limiter and
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

    // GET /trongrid - masked config for the admin form (staged, not yet consumed)
    router.get('/trongrid', controller.getTronGridConfig);

    // PUT /trongrid - persist non-secret config changes
    router.put('/trongrid', controller.updateTronGridConfig);

    // POST /trongrid/keys - append a key to the rotation pool
    router.post('/trongrid/keys', controller.addTronGridApiKey);

    // DELETE /trongrid/keys/:index - drop the key at a rotation position
    router.delete('/trongrid/keys/:index', controller.removeTronGridApiKey);

    // POST /trongrid/test - probe the stored config, one call per stored key
    router.post('/trongrid/test', controller.testTronGrid);

    return router;
}
