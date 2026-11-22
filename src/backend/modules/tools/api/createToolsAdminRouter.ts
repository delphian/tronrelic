/**
 * @fileoverview Route factory for the tools module's admin endpoints.
 *
 * The router carries only the handlers. `ToolsModule.run()` mounts it at
 * `/api/admin/tools` behind the admin rate limiter and `requireAdmin`, the
 * same chain every module's admin router uses.
 */

import { Router } from 'express';
import { asyncHandler } from '../../../api/middleware/async-handler.js';
import type { ToolsAdminController } from './ToolsAdminController.js';

/**
 * Create the admin router for the Bootstrap tab.
 *
 * @param controller - The admin controller holding the handlers.
 * @returns A router exposing `GET /bootstrap` and `POST /bootstrap/:id`.
 */
export function createToolsAdminRouter(controller: ToolsAdminController): Router {
    const router = Router();

    router.get('/bootstrap', asyncHandler(controller.listBootstrapPages));
    router.post('/bootstrap/:id', asyncHandler(controller.createBootstrapPage));

    return router;
}
