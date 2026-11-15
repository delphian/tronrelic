/**
 * @fileoverview Admin controller for the Better Auth account directory.
 *
 * Backs the `/system/users` admin dashboard. Every read flows through
 * `AccountDirectoryService` — the sole sanctioned reader of
 * `module_user_auth_users` outside the identity module's own write paths — so
 * this controller never touches the collection directly.
 *
 * All routes are mounted under `/api/admin/users` behind the `requireAdmin`
 * middleware applied at the parent router. Handlers are thin: they parse query
 * params, delegate to the service, and shape the JSON response.
 *
 * There are two writes. Deleting an account goes through
 * `AccountDeletionService`, which owns the rules for it, so the handler only
 * validates the request shape and maps the outcome to a status code. Saving
 * the admin note goes through `AccountNoteStore`. The detail panel's reads go
 * through `AccountDetailsService`, which the identity AI tools share.
 */

import type { Request, Response } from 'express';
import type { AccountSortDirection, ISystemLogService, IAccountMatch, IAccountSummary } from '@/types';
import { ACCOUNT_SORT_FIELDS } from '@/types';
import type { AccountDirectoryService } from '../services/account-directory.service.js';
import type { AccountDeletionOutcome, AccountDeletionService } from '../services/AccountDeletionService.js';
import type { AccountDetailsService } from '../services/AccountDetailsService.js';
import { AccountNoteStore } from '../services/AccountNoteStore.js';
import { parsePositiveInt, parseNonNegativeInt } from '../../../api/query-params.js';

/** Sort directions the account list accepts. */
const SORT_DIRECTIONS: ReadonlyArray<AccountSortDirection> = ['asc', 'desc'];

/** Default and largest page of sign-in events the detail panel asks for. */
const DEFAULT_EVENT_PAGE = 20;
const MAX_EVENT_PAGE = 100;

/** Largest event offset accepted, so one request cannot ask the database to skip without bound. */
const MAX_EVENT_OFFSET = 100_000;

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
 */
function toAccountMatch(account: IAccountSummary): IAccountMatch {
    return { id: account.id, email: account.email, name: account.name };
}

/**
 * The status code and message for each way a deletion can be refused. Kept as
 * one table so the handler has a single place that decides what the admin page
 * shows, and so a new outcome fails to compile until it has an entry.
 */
const DELETION_REFUSALS: Record<Exclude<AccountDeletionOutcome, 'deleted'>, { status: number; error: string; message: string }> = {
    'not-found': { status: 404, error: 'NotFound', message: 'Account not found' },
    'email-mismatch': { status: 400, error: 'EmailMismatch', message: 'The email address typed does not match this account' },
    'self': { status: 409, error: 'CannotDeleteSelf', message: 'You cannot delete your own account' },
    'last-admin': { status: 409, error: 'LastAdmin', message: 'This is the only admin account, so it cannot be deleted' }
};

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
     * @param accountDeletion - Soft-deletes an account and enforces the rules for it.
     * @param accountDetails - Assembles one account's full admin view for the detail panel.
     * @param accountNotes - Stores the admin note kept about each account.
     * @param logger - Identity-module child logger.
     */
    constructor(
        private readonly accountDirectory: AccountDirectoryService,
        private readonly accountDeletion: AccountDeletionService,
        private readonly accountDetails: AccountDetailsService,
        private readonly accountNotes: AccountNoteStore,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * GET /api/admin/users/:id/details
     *
     * Everything the user detail panel shows for one account: the account,
     * the admin note, live sessions, wallets, connected apps, and the latest
     * sign-in events. Responds `IAccountDetails`, 400 for a malformed id, and
     * 404 for an unknown account.
     *
     * @param req - Express request; reads the `:id` path param.
     * @param res - Express response.
     * @returns Resolves once the response has been written.
     */
    async getAccountDetails(req: Request, res: Response): Promise<void> {
        const id = req.params.id;
        if (!BA_USER_ID_PATTERN.test(id)) {
            res.status(400).json({ error: 'InvalidId', message: 'The account id must be a 24-character hex id' });
        } else {
            try {
                const account = await this.accountDirectory.getAccount(id);
                if (account) {
                    res.json(await this.accountDetails.getDetails(account));
                } else {
                    res.status(404).json({ error: 'NotFound', message: `Account "${id}" not found` });
                }
            } catch (error) {
                this.logger.error({ err: error, id }, 'Failed to read account details');
                res.status(500).json({ error: 'InternalError', message: 'Failed to read account details' });
            }
        }
        return;
    }

    /**
     * GET /api/admin/users/:id/sign-in-events?limit=&offset=
     *
     * One page of the sign-in events naming the account's email, newest
     * first, for the detail panel's "show more". Responds `{ events, total }`.
     *
     * @param req - Express request; reads the `:id` path param and `limit`, `offset`.
     * @param res - Express response.
     * @returns Resolves once the response has been written.
     */
    async listAccountSignInEvents(req: Request, res: Response): Promise<void> {
        const id = req.params.id;
        if (!BA_USER_ID_PATTERN.test(id)) {
            res.status(400).json({ error: 'InvalidId', message: 'The account id must be a 24-character hex id' });
        } else {
            try {
                const account = await this.accountDirectory.getAccount(id);
                if (account) {
                    const limit = parsePositiveInt(req.query.limit, DEFAULT_EVENT_PAGE, MAX_EVENT_PAGE);
                    const offset = Math.min(parseNonNegativeInt(req.query.offset, 0), MAX_EVENT_OFFSET);
                    res.json(await this.accountDetails.listSignInEvents(account, { limit, offset }));
                } else {
                    res.status(404).json({ error: 'NotFound', message: `Account "${id}" not found` });
                }
            } catch (error) {
                this.logger.error({ err: error, id }, 'Failed to list account sign-in events');
                res.status(500).json({ error: 'InternalError', message: 'Failed to list sign-in events' });
            }
        }
        return;
    }

    /**
     * PUT /api/admin/users/:id/note
     *
     * Save or clear the admin note on an account. Body `{ note }`; an empty
     * string clears it. The acting admin is recorded on the note, or null for
     * the `ADMIN_API_TOKEN` service path. Responds `{ adminNote }` (null once
     * cleared), 400 for a malformed id or note, and 404 for an unknown account.
     *
     * @param req - Express request; reads the `:id` path param, `note` from the body, and the acting admin.
     * @param res - Express response.
     * @returns Resolves once the response has been written.
     */
    async setAccountNote(req: Request, res: Response): Promise<void> {
        const id = req.params.id;
        const checked = AccountNoteStore.validate((req.body as { note?: unknown } | undefined)?.note);
        if (!BA_USER_ID_PATTERN.test(id)) {
            res.status(400).json({ error: 'InvalidId', message: 'The account id must be a 24-character hex id' });
        } else if (!checked.ok) {
            res.status(400).json({ error: 'InvalidNote', message: checked.message });
        } else {
            try {
                const account = await this.accountDirectory.getAccount(id);
                if (account) {
                    // Key the note by the resolved account's canonical id, not the
                    // path string. The id pattern and the ObjectId lookup both accept
                    // mixed-case hex, but the note store matches `userId` as an exact
                    // string, so a raw uppercase path would write a note no read finds.
                    const saved = await this.accountNotes.set(account.id, checked.note, req.userId ?? null);
                    res.json({ adminNote: await this.accountDetails.toAdminNote(saved) });
                } else {
                    res.status(404).json({ error: 'NotFound', message: `Account "${id}" not found` });
                }
            } catch (error) {
                this.logger.error({ err: error, id }, 'Failed to save account note');
                res.status(500).json({ error: 'InternalError', message: 'Failed to save the note' });
            }
        }
        return;
    }

    /**
     * DELETE /api/admin/users/:id
     *
     * Soft-delete an account. The body must carry `confirmEmail`, the
     * account's email address as the admin typed it in the confirmation
     * dialog; the service compares it with the stored address. The route is
     * mounted behind `requireAdminUser`, so `req.userId` is the signed-in
     * admin, and a request without one is refused rather than attributed to
     * nobody.
     *
     * Responds `{ deleted: true }` on success, 400 for a malformed request or
     * a wrong email, 404 for an unknown account, and 409 when the target is
     * the caller or the only admin.
     *
     * @param req - Express request; reads the `:id` path param and `confirmEmail` from the body.
     * @param res - Express response.
     * @returns Resolves once the response has been written.
     */
    async deleteAccount(req: Request, res: Response): Promise<void> {
        const id = req.params.id;
        const actorUserId = req.userId;
        const confirmEmail: unknown = (req.body as { confirmEmail?: unknown } | undefined)?.confirmEmail;

        if (!actorUserId) {
            res.status(403).json({ error: 'Forbidden', message: 'Deleting an account requires a signed-in admin' });
        } else if (!BA_USER_ID_PATTERN.test(id)) {
            res.status(400).json({ error: 'InvalidId', message: 'The account id must be a 24-character hex id' });
        } else if (typeof confirmEmail !== 'string' || !confirmEmail.trim()) {
            res.status(400).json({ error: 'MissingConfirmation', message: 'confirmEmail is required' });
        } else {
            try {
                const outcome = await this.accountDeletion.softDelete({ targetUserId: id, actorUserId, confirmEmail });
                if (outcome === 'deleted') {
                    res.json({ deleted: true });
                } else {
                    const refusal = DELETION_REFUSALS[outcome];
                    res.status(refusal.status).json({ error: refusal.error, message: refusal.message });
                }
            } catch (error) {
                this.logger.error({ err: error, id }, 'Failed to delete account');
                res.status(500).json({ error: 'InternalError', message: 'Failed to delete account' });
            }
        }

        return;
    }

    /**
     * GET /api/admin/users
     *
     * Paginated account list with optional case-insensitive `search` against
     * email/name, sorted by `sortBy` (one of `ACCOUNT_SORT_FIELDS`, default
     * `createdAt`) in `sortDirection` (`asc` or `desc`, default `desc`).
     * Returns `{ accounts: IAccountSummary[], total: number }` where `total`
     * ignores pagination. An unknown sort value is answered with 400 rather
     * than silently ignored, so a typo in a script is noticed.
     *
     * @param req - Express request; reads `limit`, `skip`, `search`, `sortBy`, `sortDirection` query params.
     * @param res - Express response.
     * @returns Resolves once the response has been written.
     */
    async listAccounts(req: Request, res: Response): Promise<void> {
        const sortBy = ACCOUNT_SORT_FIELDS.find(field => field === req.query.sortBy);
        const sortDirection = SORT_DIRECTIONS.find(direction => direction === req.query.sortDirection);
        if (req.query.sortBy !== undefined && !sortBy) {
            res.status(400).json({ error: 'InvalidSort', message: `sortBy must be one of ${ACCOUNT_SORT_FIELDS.join(', ')}` });
        } else if (req.query.sortDirection !== undefined && !sortDirection) {
            res.status(400).json({ error: 'InvalidSort', message: `sortDirection must be one of ${SORT_DIRECTIONS.join(', ')}` });
        } else {
            try {
                const limit = parsePositiveInt(req.query.limit, DEFAULT_LIMIT, MAX_LIMIT);
                const skip = parseNonNegativeInt(req.query.skip, 0);
                const search = typeof req.query.search === 'string' && req.query.search.trim()
                    ? req.query.search.trim()
                    : undefined;

                const result = await this.accountDirectory.listAccounts({ limit, skip, search, sortBy, sortDirection });
                res.json(result);
            } catch (error) {
                this.logger.error({ err: error }, 'Failed to list accounts');
                res.status(500).json({ error: 'InternalError', message: 'Failed to list accounts' });
            }
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
