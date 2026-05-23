/**
 * @fileoverview Router factory for the zone-introspection admin
 * endpoint.
 *
 * Single read-only `GET /` route returning the registry snapshot.
 * Caller mounts the router under `/api/admin/system/zones` with the
 * `requireAdmin` middleware applied at mount time, so the router
 * itself stays unauthenticated.
 *
 * @module backend/modules/widgets/api/zones.routes
 */

import { Router } from 'express';
import type { ZonesController } from './zones.controller.js';

/**
 * Build the zone admin router. Mounted by `WidgetsModule.run()`.
 *
 * @param controller - Controller with the request handlers bound.
 * @returns Express router with the snapshot route attached.
 */
export function createZonesAdminRouter(controller: ZonesController): Router {
    const router = Router();
    router.get('/', controller.getSnapshot);

    return router;
}
