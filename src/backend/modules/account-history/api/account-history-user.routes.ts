/**
 * @fileoverview Express router factory for the account-history user API.
 *
 * Wires the single login-gated progress route to its handler; `requireLogin`
 * and the public rate limiter are applied at mount time in the module's `run()`,
 * matching the platform convention used by the admin router.
 */

import { Router } from 'express';
import type { AccountHistoryUserController } from './account-history-user.controller.js';

/**
 * Build the account-history user router.
 *
 * @param controller - The controller whose handler backs the route.
 * @returns A configured Express router (unmounted, unguarded).
 */
export function createAccountHistoryUserRouter(controller: AccountHistoryUserController): Router {
    const router = Router();

    router.get('/me/progress', controller.getMyProgress);

    return router;
}
