/**
 * @fileoverview Router factory for the placements admin endpoint set.
 *
 * Mounted by `WidgetsModule.run()` under
 * `/api/admin/system/widgets/placements`. Authentication and the
 * platform-default admin rate limiter are applied at mount time, so
 * the router itself does not re-apply either.
 *
 * @module backend/modules/widgets/api/placements.routes
 */

import { Router } from 'express';
import type { PlacementsController } from './placements.controller.js';

/**
 * Build the placements admin router with all CRUD endpoints plus the
 * restore-defaults action.
 *
 * @param controller - Controller with the request handlers bound.
 * @returns Express router ready to mount.
 */
export function createPlacementsAdminRouter(controller: PlacementsController): Router {
    const router = Router();

    router.get('/', controller.listPlacements);
    router.get('/:id', controller.getPlacement);
    router.post('/', controller.createPlacement);
    router.patch('/:id', controller.updatePlacement);
    router.delete('/:id', controller.deletePlacement);
    router.post('/:id/restore-defaults', controller.restorePluginDefaults);

    return router;
}
