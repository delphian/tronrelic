/**
 * @fileoverview Admin controller for the Better Auth account directory.
 *
 * Backs the `/system/users` admin dashboard now that it reads Better Auth
 * accounts instead of the legacy UUID `users` collection. Every read flows
 * through `AccountDirectoryService` — the sole sanctioned reader of
 * `module_user_auth_users` outside the identity module's own write paths — so
 * this controller never touches the collection directly.
 *
 * All routes are mounted under `/api/admin/users` behind the `requireAdmin`
 * middleware applied at the parent router. Handlers are thin: they parse query
 * params, delegate to the service, and shape the JSON response.
 */

import type { Request, Response } from 'express';
import type { ISystemLogService } from '@/types';
import type { AccountDirectoryService } from '../services/account-directory.service.js';
import { parsePositiveInt, parseNonNegativeInt } from '../../../api/query-params.js';

/** Default page size for the account list — mirrors the service default. */
const DEFAULT_LIMIT = 50;

/** Hard ceiling on page size — mirrors the service ceiling. */
const MAX_LIMIT = 200;

/**
 * Controller for admin account-directory endpoints.
 *
 * Translates HTTP requests into {@link AccountDirectoryService} calls. The
 * service applies its own pagination defaults and ceilings, so the controller
 * passes parsed values straight through.
 */
export class AccountsController {
    /**
     * @param accountDirectory - Read-only directory over Better Auth accounts.
     * @param logger - Identity-module child logger.
     */
    constructor(
        private readonly accountDirectory: AccountDirectoryService,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * GET /api/admin/users
     *
     * Paginated account list with optional case-insensitive `search` against
     * email/name. Returns `{ accounts: IAccountSummary[], total: number }`
     * where `total` ignores pagination.
     *
     * @param req - Express request; reads `limit`, `skip`, `search` query params.
     * @param res - Express response.
     * @returns Resolves once the response has been written.
     */
    async listAccounts(req: Request, res: Response): Promise<void> {
        try {
            const limit = parsePositiveInt(req.query.limit, DEFAULT_LIMIT, MAX_LIMIT);
            const skip = parseNonNegativeInt(req.query.skip, 0);
            const search = typeof req.query.search === 'string' && req.query.search.trim()
                ? req.query.search.trim()
                : undefined;

            const result = await this.accountDirectory.listAccounts({ limit, skip, search });
            res.json(result);
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to list accounts');
            res.status(500).json({ error: 'InternalError', message: 'Failed to list accounts' });
        }

        return;
    }

    /**
     * GET /api/admin/users/:id
     *
     * Single account summary by Better Auth user id. 404 when no such account
     * exists.
     *
     * @param req - Express request; reads the `:id` path param.
     * @param res - Express response.
     * @returns Resolves once the response has been written.
     */
    async getAccount(req: Request, res: Response): Promise<void> {
        const id = req.params.id;
        try {
            const account = await this.accountDirectory.getAccount(id);
            if (!account) {
                res.status(404).json({ error: 'NotFound', message: `Account "${id}" not found` });
                return;
            }
            res.json({ account });
        } catch (error) {
            this.logger.error({ err: error, id }, 'Failed to get account');
            res.status(500).json({ error: 'InternalError', message: 'Failed to get account' });
        }

        return;
    }
}
