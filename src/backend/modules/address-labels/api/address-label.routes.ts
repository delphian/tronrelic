/**
 * Address label route factories.
 *
 * Creates Express routers for public and admin address label endpoints.
 * Following the IoC pattern, these are called by the module and mounted
 * by the module itself.
 */

import { Router } from 'express';
import type { AddressLabelController } from './address-label.controller.js';

/**
 * Create the public router for address label lookups.
 *
 * Provides read-only access to address labels:
 * - GET /:address - Look up single address
 * - GET /:address/resolve - Get label with alternates
 * - POST /bulk - Bulk lookup multiple addresses
 * - GET /search - Text search labels
 *
 * @param controller - Address label controller instance
 * @returns Express router with public endpoints
 */
export function createPublicRouter(controller: AddressLabelController): Router {
    const router = Router();

    // Search must come before :address to avoid route conflict
    router.get('/search', controller.search.bind(controller));

    // Bulk lookup
    router.post('/bulk', controller.bulkLookup.bind(controller));

    // Resolve with alternates
    router.get('/:address/resolve', controller.resolveLabel.bind(controller));

    // Single address lookup
    router.get('/:address', controller.getByAddress.bind(controller));

    return router;
}

/**
 * Create the admin router for address label management.
 *
 * Provides full CRUD access (requires admin authentication):
 * - GET / - List labels with filtering
 * - POST / - Create new label
 * - PATCH /:address - Update label
 * - DELETE /:address - Delete label
 * - GET /stats - Get statistics
 * - POST /import - Bulk import
 * - GET /export - Export labels
 *
 * @param controller - Address label controller instance
 * @returns Express router with admin endpoints
 */
export function createAdminRouter(controller: AddressLabelController): Router {
    const router = Router();

    // Statistics
    router.get('/stats', controller.getStats.bind(controller));

    // Import/Export
    router.post('/import', controller.importLabels.bind(controller));
    router.get('/export', controller.exportLabels.bind(controller));

    // List with filtering
    router.get('/', controller.list.bind(controller));

    // Create
    router.post('/', controller.create.bind(controller));

    // Update
    router.patch('/:address', controller.update.bind(controller));

    // Delete
    router.delete('/:address', controller.delete.bind(controller));

    return router;
}
