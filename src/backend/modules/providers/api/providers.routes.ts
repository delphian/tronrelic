/**
 * @fileoverview Router for the external-providers admin API.
 *
 * Mounts the vendor endpoints under `/api/admin/system/providers`: a list of
 * every registered vendor, then generic read/write/test by vendor id, plus the
 * bespoke TronGrid routes for its rotating key pool. The TronGrid routes are
 * declared before the `/:id` routes so Express matches them first. The module
 * applies the admin rate limiter and `requireAdmin` at mount time, so this
 * factory only wires paths to handlers.
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

    // GET / - every registered vendor: descriptor plus masked config
    router.get('/', controller.listProviders);

    // TronGrid keeps bespoke handlers for its key pool; declared ahead of /:id.
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

    // GET /:id - one vendor's masked config
    router.get('/:id', controller.getProviderConfig);

    // PUT /:id - persist config changes validated against the vendor's descriptor
    router.put('/:id', controller.updateProviderConfig);

    // POST /:id/test - the vendor's live connectivity/credential check
    router.post('/:id/test', controller.testProvider);

    return router;
}
