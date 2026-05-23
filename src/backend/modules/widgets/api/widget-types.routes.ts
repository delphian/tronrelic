/**
 * @fileoverview Router factory for the widget-types introspection
 * admin endpoint.
 *
 * Single read-only `GET /` route returning the registry snapshot.
 * Mounted under `/api/admin/system/widget-types` by
 * `WidgetsModule.run()` with `requireAdmin` and the admin rate
 * limiter applied at mount time.
 *
 * @module backend/modules/widgets/api/widget-types.routes
 */

import { Router } from 'express';
import type { WidgetTypesController } from './widget-types.controller.js';

/**
 * Build the widget-types admin router.
 *
 * @param controller - Controller with the snapshot handler bound.
 * @returns Express router with the snapshot route attached.
 */
export function createWidgetTypesAdminRouter(controller: WidgetTypesController): Router {
    const router = Router();
    router.get('/', controller.getSnapshot);
    return router;
}
