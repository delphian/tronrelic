/**
 * @fileoverview Admin HTTP layer for ClickHouse accounts.
 *
 * Thin by design: each handler reads its parameters, calls the accounts
 * service, and translates a `ClickHouseAccountError` into its HTTP status.
 * Every rule about what may change lives in the service, so the API and any
 * future caller enforce the same rules.
 *
 * Routes that change an account or stop a query are mounted behind
 * `requireAdminUser` as well as `requireAdmin`, so they refuse the shared
 * `ADMIN_API_TOKEN` and always have a signed-in admin to attribute the audit
 * entry to.
 */

import type { Request, Response } from 'express';
import type { IClickHouseAccountService, ISystemLogService } from '@/types';
import { ClickHouseAccountError } from '../services/ClickHouseAccountError.js';

/** Longest reason an admin may attach to a limit change. */
const MAX_REASON_LENGTH = 500;

/**
 * Handlers for `/api/admin/system/clickhouse-accounts`.
 */
export class ClickHouseAccountsController {
    /**
     * @param service - The accounts service every handler delegates to.
     * @param logger - Module-scoped logger for unexpected failures.
     */
    constructor(
        private readonly service: IClickHouseAccountService,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * GET / — every declared account with its state, limits, and the
     * settings and grants ClickHouse reports.
     *
     * @param _req - Unused.
     * @param res - Responds `{ accounts }`.
     */
    listAccounts = async (_req: Request, res: Response): Promise<void> => {
        try {
            res.json({ accounts: await this.service.listAccounts() });
        } catch (error) {
            this.fail(res, error, 'Failed to list ClickHouse accounts');
        }
    };

    /**
     * GET /:id — one account's summary.
     *
     * @param req - `params.id` names the account.
     * @param res - Responds `{ account }`, or 404.
     */
    getAccount = async (req: Request, res: Response): Promise<void> => {
        try {
            const account = await this.service.getAccount(String(req.params.id));
            if (account) {
                res.json({ account });
            } else {
                res.status(404).json({ error: `No ClickHouse account "${String(req.params.id)}"` });
            }
        } catch (error) {
            this.fail(res, error, 'Failed to read ClickHouse account');
        }
    };

    /**
     * PUT /:id/limits — change some of a managed account's limits. Body:
     * `{ limits: { <field>: number, ... }, reason?: string }`.
     *
     * @param req - `params.id` names the account; `userId` is the admin, set
     *   by `requireAdmin` and guaranteed by `requireAdminUser`.
     * @param res - Responds `{ account }` with the updated summary.
     */
    updateLimits = async (req: Request, res: Response): Promise<void> => {
        try {
            const limits = req.body?.limits;
            const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, MAX_REASON_LENGTH) : '';
            if (!limits || typeof limits !== 'object' || Array.isArray(limits)) {
                res.status(400).json({ error: 'Body must be { limits: { <field>: number }, reason?: string }' });
            } else {
                const account = await this.service.updateLimits(
                    String(req.params.id),
                    limits,
                    String(req.userId),
                    reason.length > 0 ? reason : null
                );
                res.json({ account });
            }
        } catch (error) {
            this.fail(res, error, 'Failed to update ClickHouse account limits');
        }
    };

    /**
     * POST /:id/apply — apply a managed account to ClickHouse again.
     *
     * @param req - `params.id` names the account; `userId` is the admin.
     * @param res - Responds `{ account }`; its `state` and `error` report the outcome.
     */
    applyAccount = async (req: Request, res: Response): Promise<void> => {
        try {
            res.json({ account: await this.service.applyAccount(String(req.params.id), String(req.userId)) });
        } catch (error) {
            this.fail(res, error, 'Failed to apply ClickHouse account');
        }
    };

    /**
     * GET /:id/queries?scope=running|recent&limit=N — the account's running or
     * recent queries.
     *
     * @param req - `params.id` names the account; `scope` defaults to `recent`
     *   and `limit` to 50.
     * @param res - Responds `{ queries }`.
     */
    listQueries = async (req: Request, res: Response): Promise<void> => {
        try {
            const scope = req.query.scope === 'running' ? 'running' : 'recent';
            const limit = Number(req.query.limit ?? 50);
            const queries = await this.service.listQueries(String(req.params.id), scope, Number.isFinite(limit) ? limit : 50);
            res.json({ queries });
        } catch (error) {
            this.fail(res, error, 'Failed to list ClickHouse account queries');
        }
    };

    /**
     * POST /:id/queries/:queryId/kill — stop one running query the account owns.
     *
     * @param req - `params.id` names the account and `params.queryId` the
     *   query; `userId` is the admin.
     * @param res - Responds `{ killed }`, false when the query was no longer running.
     */
    killQuery = async (req: Request, res: Response): Promise<void> => {
        try {
            const killed = await this.service.killQuery(String(req.params.id), String(req.params.queryId), String(req.userId));
            res.json({ killed });
        } catch (error) {
            this.fail(res, error, 'Failed to stop ClickHouse query');
        }
    };

    /**
     * GET /:id/usage?days=N — current hourly quota usage and daily history.
     *
     * @param req - `params.id` names the account; `days` defaults to 30.
     * @param res - Responds `{ quota, history }`.
     */
    getUsage = async (req: Request, res: Response): Promise<void> => {
        try {
            const accountId = String(req.params.id);
            const days = Number(req.query.days ?? 30);
            const [quota, history] = await Promise.all([
                this.service.getQuotaUsage(accountId),
                this.service.getUsageHistory(accountId, Number.isFinite(days) ? days : 30)
            ]);
            res.json({ quota, history });
        } catch (error) {
            this.fail(res, error, 'Failed to read ClickHouse account usage');
        }
    };

    /**
     * GET /:id/audit?limit=N — admin actions recorded against the account.
     *
     * @param req - `params.id` names the account; `limit` defaults to 50.
     * @param res - Responds `{ entries }`.
     */
    listAudit = async (req: Request, res: Response): Promise<void> => {
        try {
            const limit = Number(req.query.limit ?? 50);
            const entries = await this.service.listAudit(String(req.params.id), Number.isFinite(limit) ? limit : 50);
            res.json({ entries });
        } catch (error) {
            this.fail(res, error, 'Failed to read ClickHouse account audit');
        }
    };

    /**
     * Answer a failed request: the service's own refusals with their status
     * and message, anything unexpected as a logged 500.
     *
     * @param res - Response to write.
     * @param error - What was thrown.
     * @param message - Log message and fallback error text for an unexpected failure.
     */
    private fail(res: Response, error: unknown, message: string): void {
        if (error instanceof ClickHouseAccountError) {
            res.status(error.status).json({ error: error.message });
        } else {
            this.logger.error({ error }, message);
            res.status(500).json({ error: message });
        }
    }
}
