/**
 * @fileoverview Router factory for the address page's data routes.
 *
 * The rate limiter and `requireLogin` are applied by the module when it
 * mounts this router, so this factory only declares the routes.
 */

import { Router } from 'express';
import type { AddressExplorerController } from './AddressExplorerController.js';

/**
 * Build the `/api/address-explorer` router.
 *
 * @param controller - The address page's handlers.
 * @returns A router with the span section and transfers routes.
 */
export function createAddressExplorerRouter(controller: AddressExplorerController): Router {
    const router = Router();
    router.get('/:address/sections/:section', controller.getSpanSection);
    router.get('/:address/transfers', controller.getTransfers);
    return router;
}
