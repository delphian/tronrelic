/**
 * @fileoverview Express router factory for the account-history admin API.
 *
 * The factory wires routes to controller handlers only; `requireAdmin` and the
 * admin rate limiter are applied at mount time in the module's `run()`, matching
 * the platform convention. Static segments are declared before the dynamic
 * `:address` routes so they are not shadowed.
 */

import { Router } from 'express';
import type { AccountHistoryController } from './account-history.controller.js';

/**
 * Build the account-history admin router.
 *
 * @param controller - The controller whose handlers back each route.
 * @returns A configured Express router (unmounted, unguarded).
 */
export function createAccountHistoryRouter(controller: AccountHistoryController): Router {
    const router = Router();

    router.get('/stats', controller.getStats);
    router.get('/settings', controller.getSettings);
    router.patch('/settings', controller.updateSettings);
    router.post('/ingest/run', controller.runIngestion);
    router.post('/ingest/forward/run', controller.runForwardSync);
    router.post('/ingest/backfill-ledger/run', controller.runLedgerBackfill);

    router.get('/accounts', controller.listTrackedAccounts);
    router.post('/accounts', controller.addTrackedAccount);
    router.get('/accounts/:address/transactions', controller.getTransactions);
    router.patch('/accounts/:address/paused', controller.setAccountPaused);
    router.delete('/accounts/:address', controller.removeTrackedAccount);

    return router;
}
