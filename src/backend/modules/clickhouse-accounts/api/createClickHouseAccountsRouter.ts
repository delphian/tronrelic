/**
 * @fileoverview Router factory for the ClickHouse accounts admin API.
 *
 * `requireAdmin` and the rate limiter are applied where the module mounts
 * this router. The routes that change an account or stop a query add
 * `requireAdminUser` here, because those actions must be attributed to a
 * signed-in admin rather than to the shared service token.
 */

import { Router } from 'express';
import { requireAdminUser } from '../../../api/middleware/admin-auth.js';
import type { ClickHouseAccountsController } from './ClickHouseAccountsController.js';

/**
 * Build the router mounted at `/api/admin/system/clickhouse-accounts`.
 *
 * @param controller - Handlers for each route.
 * @returns The configured router.
 */
export function createClickHouseAccountsRouter(controller: ClickHouseAccountsController): Router {
    const router = Router();
    router.get('/', controller.listAccounts);
    router.get('/:id', controller.getAccount);
    router.put('/:id/limits', requireAdminUser, controller.updateLimits);
    router.post('/:id/apply', requireAdminUser, controller.applyAccount);
    router.get('/:id/queries', controller.listQueries);
    router.post('/:id/queries/:queryId/kill', requireAdminUser, controller.killQuery);
    router.get('/:id/usage', controller.getUsage);
    router.get('/:id/audit', controller.listAudit);

    return router;
}
