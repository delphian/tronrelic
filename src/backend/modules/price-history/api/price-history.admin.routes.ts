/**
 * @fileoverview Router factory for the price-history admin endpoints.
 *
 * Guards (admin rate limit + `requireAdmin`) are applied at mount time by the
 * module, mirroring the account-history admin router, so this factory only
 * declares the route shape.
 */

import { Router } from 'express';
import type { PriceHistoryAdminController } from './price-history.admin.controller.js';

/**
 * Build the `/api/admin/system/price-history` router.
 *
 * @param controller - The admin controller.
 * @returns A router with the stats, settings, and manual-run routes.
 */
export function createPriceHistoryAdminRouter(controller: PriceHistoryAdminController): Router {
    const router = Router();
    router.get('/stats', controller.getStats);
    router.get('/diagnostics', controller.getDiagnostics);
    router.get('/settings', controller.getSettings);
    router.patch('/settings', controller.updateSettings);
    router.post('/backfill/run', controller.runBackfill);
    router.post('/forward/run', controller.runForward);
    return router;
}
