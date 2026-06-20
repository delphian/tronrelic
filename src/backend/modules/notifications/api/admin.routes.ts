/**
 * @fileoverview Router factory for the admin notification endpoints. Mounted
 * behind `createAdminRateLimiter` + `requireAdmin` by the module, so the routes
 * here carry no auth of their own.
 */

import { Router } from 'express';
import type { AdminController } from './admin.controller.js';

/**
 * Build the `/api/admin/system/notifications` router.
 *
 * @param controller - The admin controller.
 * @returns An Express router for category/channel policy and audit history.
 */
export function createAdminRouter(controller: AdminController): Router {
    const router = Router();
    router.get('/categories', controller.getCategories);
    router.patch('/categories/:id', controller.setCategory);
    router.get('/channels', controller.getChannels);
    router.patch('/channels/:id', controller.setChannel);
    router.get('/history', controller.getHistory);
    return router;
}
