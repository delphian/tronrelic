/**
 * @fileoverview Thin HTTP layer for the account-history admin API.
 *
 * Every handler does request plumbing only — parse input, call one
 * `IAccountHistoryService` method, shape the response — so all behavior lives
 * behind the central service. Responses are the raw resource or, on failure,
 * `{ error, message }`, matching the platform's controller convention.
 */

import type { Request, Response } from 'express';
import type { IAccountHistoryService, ISystemLogService } from '@/types';

/**
 * Admin controller for tracked accounts, pacing settings, stats, history reads,
 * and manual ingestion triggering.
 */
export class AccountHistoryController {
    /**
     * @param service - The central account-history service (all heavy lifting).
     * @param logger - Scoped logger for handler-level error reporting.
     */
    constructor(
        private readonly service: IAccountHistoryService,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * GET /accounts — list the tracked set.
     */
    listTrackedAccounts = async (_req: Request, res: Response): Promise<void> => {
        try {
            const accounts = await this.service.listTrackedAccounts();
            res.json({ accounts });
        } catch (error) {
            this.fail(res, 500, 'Failed to list tracked accounts', error);
        }
    };

    /**
     * POST /accounts — begin tracking an account. Body: `{ address, label? }`.
     */
    addTrackedAccount = async (req: Request, res: Response): Promise<void> => {
        try {
            const { address, label } = req.body ?? {};
            const account = await this.service.addTrackedAccount({ address, label });
            res.status(201).json(account);
        } catch (error) {
            this.fail(res, 400, 'Failed to add tracked account', error);
        }
    };

    /**
     * DELETE /accounts/:address — stop tracking (retains stored history).
     */
    removeTrackedAccount = async (req: Request, res: Response): Promise<void> => {
        try {
            await this.service.removeTrackedAccount(req.params.address);
            res.status(204).end();
        } catch (error) {
            this.fail(res, 400, 'Failed to remove tracked account', error);
        }
    };

    /**
     * PATCH /accounts/:address/paused — pause or resume one account. Body: `{ paused }`.
     */
    setAccountPaused = async (req: Request, res: Response): Promise<void> => {
        try {
            const paused = Boolean(req.body?.paused);
            const account = await this.service.setAccountPaused(req.params.address, paused);
            res.json(account);
        } catch (error) {
            this.fail(res, 400, 'Failed to update account pause state', error);
        }
    };

    /**
     * GET /accounts/:address/transactions — paged history read. Query: `limit`, `offset`.
     */
    getTransactions = async (req: Request, res: Response): Promise<void> => {
        try {
            const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;
            const offset = req.query.offset ? parseInt(String(req.query.offset), 10) : undefined;
            const page = await this.service.getTransactions({ address: req.params.address, limit, offset });
            res.json(page);
        } catch (error) {
            this.fail(res, 400, 'Failed to read account transactions', error);
        }
    };

    /**
     * GET /settings — current pacing settings.
     */
    getSettings = async (_req: Request, res: Response): Promise<void> => {
        try {
            const settings = await this.service.getSettings();
            res.json(settings);
        } catch (error) {
            this.fail(res, 500, 'Failed to read settings', error);
        }
    };

    /**
     * PATCH /settings — merge pacing settings. Body: partial settings.
     */
    updateSettings = async (req: Request, res: Response): Promise<void> => {
        try {
            const settings = await this.service.updateSettings(req.body ?? {});
            res.json(settings);
        } catch (error) {
            this.fail(res, 400, 'Failed to update settings', error);
        }
    };

    /**
     * GET /stats — full stats snapshot (settings, per-account progress, totals).
     */
    getStats = async (_req: Request, res: Response): Promise<void> => {
        try {
            const stats = await this.service.getStats();
            res.json(stats);
        } catch (error) {
            this.fail(res, 500, 'Failed to read stats', error);
        }
    };

    /**
     * POST /ingest/run — manually advance ingestion by one bounded tick.
     */
    runIngestion = async (_req: Request, res: Response): Promise<void> => {
        try {
            await this.service.runIngestionTick();
            res.status(202).json({ started: true });
        } catch (error) {
            this.fail(res, 500, 'Failed to run ingestion tick', error);
        }
    };

    /**
     * Log and emit a uniform error response.
     *
     * @param res - The response to write.
     * @param status - HTTP status code.
     * @param error - Human-facing summary; also the log message.
     * @param cause - The caught error, surfaced as `message`.
     */
    private fail(res: Response, status: number, error: string, cause: unknown): void {
        this.logger.error({ error: cause }, error);
        res.status(status).json({ error, message: cause instanceof Error ? cause.message : 'Unknown error' });
    }
}
