/**
 * @fileoverview Router factory for the valuation admin endpoints.
 *
 * Guards (admin rate limit + `requireAdmin`) are applied at mount time by the
 * module, mirroring the price-history and account-history admin routers, so
 * this factory only declares the route shape.
 */

import { Router } from 'express';
import type { ValuationAdminController } from './valuation-admin.controller.js';

/**
 * Build the `/api/admin/system/valuation` router.
 *
 * @param controller - The admin controller.
 * @returns A router with the per-wallet balance-range override routes.
 */
export function createValuationAdminRouter(controller: ValuationAdminController): Router {
    const router = Router();
    router.get('/users/:userId/wallets/:address/balance-range', controller.getBalanceRange);
    router.patch('/users/:userId/wallets/:address/balance-range', controller.setBalanceRange);
    return router;
}
