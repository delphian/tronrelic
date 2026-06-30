/**
 * @fileoverview Router factory for the login-gated valuation endpoints.
 *
 * Guards (rate limit + `requireLogin`) are applied at mount time by the module,
 * mirroring the account-history user router, so this factory only declares the
 * route shape.
 */

import { Router } from 'express';
import type { ValuationUserController } from './valuation-user.controller.js';

/**
 * Build the `/api/valuation` user router.
 *
 * @param controller - The login-gated valuation controller.
 * @returns A router with the aggregate and per-wallet portfolio routes.
 */
export function createValuationUserRouter(controller: ValuationUserController): Router {
    const router = Router();
    router.get('/me/portfolio', controller.getMyPortfolio);
    router.get('/me/wallets/:address/portfolio', controller.getMyWalletPortfolio);
    return router;
}
