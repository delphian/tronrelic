/**
 * @fileoverview Router for the MCP admin API, mounted at `/api/admin/mcp`.
 *
 * Every route is rate-limited and admin-gated, with the rate limiter first so
 * it bounds brute-force attempts against the gate itself. Routes that widen
 * access check for a signed-in admin inside the controller, because the same
 * route also accepts the narrowing direction from the service token.
 */

import { Router } from 'express';
import type { McpAdminController } from './mcp-admin.controller.js';
import { requireAdmin } from '../../../api/middleware/admin-auth.js';
import { asyncHandler } from '../../../api/middleware/async-handler.js';
import { createAdminRateLimiter } from '../../../api/middleware/rate-limit.js';

/**
 * Build the MCP admin router.
 *
 * @param controller - The controller whose handlers back each route.
 * @returns The configured router.
 */
export function createMcpAdminRouter(controller: McpAdminController): Router {
    const router = Router();

    router.use(createAdminRateLimiter('mcp-admin'));
    router.use(requireAdmin);

    router.get('/status', asyncHandler(controller.getStatus));
    router.put('/settings', asyncHandler(controller.setSettings));

    router.get('/tools', asyncHandler(controller.listTools));
    router.put('/tools/:name', asyncHandler(controller.setToolExposure));

    router.get('/groups', asyncHandler(controller.listGroups));
    router.put('/groups/:groupId/policy', asyncHandler(controller.setGroupPolicy));

    router.get('/apps', asyncHandler(controller.listApps));
    router.delete('/apps/:userId', asyncHandler(controller.revokeApp));

    return router;
}
