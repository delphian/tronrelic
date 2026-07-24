/**
 * @fileoverview Router factories for the address-tags HTTP surfaces.
 *
 * Guards (rate limiting, `requireLogin` / `requireAdmin`) are applied at mount
 * time by the module, mirroring the valuation/account-history convention, so
 * these factories only declare route shape.
 */

import { Router } from 'express';
import type { AddressTagsUserController } from './address-tags-user.controller.js';
import type { AddressTagsAdminController } from './address-tags-admin.controller.js';

/**
 * Build the read-only router mounted at `/api/address-tags` for registered
 * users.
 *
 * @param controller - The read controller backing each route.
 * @returns The configured router.
 */
export function createAddressTagsUserRouter(controller: AddressTagsUserController): Router {
    const router = Router();
    router.get('/by-address', controller.getByAddresses);
    router.get('/by-tag', controller.getByTags);
    router.get('/tags', controller.listTags);
    return router;
}

/**
 * Build the admin router mounted at `/api/admin/system/address-tags` for the
 * mutating surface and the management-table search.
 *
 * @param controller - The admin controller backing each route.
 * @returns The configured router.
 */
export function createAddressTagsAdminRouter(controller: AddressTagsAdminController): Router {
    const router = Router();
    router.get('/tags', controller.searchTags);
    router.post('/tags', controller.createTags);
    router.patch('/tags', controller.updateTags);
    router.post('/tags/delete', controller.deleteTags);
    return router;
}
