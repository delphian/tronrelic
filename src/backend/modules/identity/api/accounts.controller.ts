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
import type { ISystemLogService, IAccountMatch, IAccountSummary } from '@/types';
import type { AccountDirectoryService } from '../services/account-directory.service.js';
import { parsePositiveInt, parseNonNegativeInt } from '../../../api/query-params.js';

/** Default page size for the account list — mirrors the service default. */
const DEFAULT_LIMIT = 50;

/** Hard ceiling on page size — mirrors the service ceiling. */
const MAX_LIMIT = 200;

/** Page size for the typeahead account search — small, it feeds a dropdown. */
const ACCOUNT_SEARCH_LIMIT = 10;

/**
 * A Better Auth user id is a 24-char hex ObjectId string. When the query is
 * exactly that, resolve it directly instead of substring-scanning email/name —
 * so a picker re-opened on a stored id resolves its label in one exact read.
 */
const BA_USER_ID_PATTERN = /^[0-9a-f]{24}$/i;

/**
 * Narrow an {@link IAccountSummary} to the {@link IAccountMatch} projection the
 * picker/search surface exposes — dropping auth-internal fields (groups,
 * wallet, verification, timestamps) an account chooser never needs.
 *
 * @param account - The full directory summary.
 * @returns The minimal id/email/name match.
 */
function toAccountMatch(account: IAccountSummary): IAccountMatch {
    return { id: account.id, email: account.email, name: account.name };
}

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
     * GET /api/admin/accounts/search?q=
     *
     * Typeahead account search backing admin account pickers (e.g. the shared
     * `context.ui.AccountPicker`). Returns the minimal {@link IAccountMatch}
     * projection — never the full summary — so admin choosers only see
     * id/email/name. An exact 24-hex query resolves the one account by id (the
     * re-open-on-stored-id case); anything else is a capped substring search.
     * An empty query returns no matches rather than the whole directory.
     *
     * @param req - Express request; reads the `q` query param.
     * @param res - Express response.
     * @returns Resolves once the response has been written.
     */
    async searchAccounts(req: Request, res: Response): Promise<void> {
        const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
        if (!q) {
            res.json({ accounts: [] });
            return;
        }

        try {
            if (BA_USER_ID_PATTERN.test(q)) {
                const account = await this.accountDirectory.getAccount(q);
                res.json({ accounts: account ? [toAccountMatch(account)] : [] });
                return;
            }

            const { accounts } = await this.accountDirectory.listAccounts({ search: q, limit: ACCOUNT_SEARCH_LIMIT });
            res.json({ accounts: accounts.map(toAccountMatch) });
        } catch (error) {
            this.logger.error({ err: error }, 'Failed to search accounts');
            res.status(500).json({ error: 'InternalError', message: 'Failed to search accounts' });
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
