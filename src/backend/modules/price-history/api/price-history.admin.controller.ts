/**
 * @fileoverview Admin HTTP layer for the price-history module.
 *
 * The price series is otherwise invisible — no user-facing page reads it — so
 * operators need a surface to confirm coverage (is TRX fully backfilled, are held
 * tokens priced or stuck), tune pacing if CoinGecko rate-limits, and force a
 * backfill after a new token is tracked. Thin handlers delegating to the service;
 * `requireAdmin` is applied at mount.
 */

import type { Request, Response } from 'express';
import type {
    IPriceHistoryService,
    IAccountHistoryService,
    IServiceRegistry,
    IPriceCoverageDiagnostics,
    ISystemLogService
} from '@/types';

/**
 * Admin controller exposing price-history coverage, settings, manual ticks, and
 * cross-module coverage diagnostics.
 */
export class PriceHistoryAdminController {
    /**
     * @param service - The price-history service all reads/actions delegate to.
     * @param serviceRegistry - Resolves `'account-history'` at request time to
     *   join held tokens against price coverage for the diagnostics endpoint.
     * @param logger - Scoped logger for handler-level error reporting.
     */
    constructor(
        private readonly service: IPriceHistoryService,
        private readonly serviceRegistry: IServiceRegistry,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * GET /stats — coverage snapshot (settings + per-asset coverage + totals).
     *
     * @param _req - Unused.
     * @param res - Emits the stats snapshot.
     */
    getStats = async (_req: Request, res: Response): Promise<void> => {
        try {
            res.json(await this.service.getStats());
        } catch (error) {
            this.fail(res, 500, 'Failed to read price-history stats', error);
        }
    };

    /**
     * GET /settings — current pacing settings.
     *
     * @param _req - Unused.
     * @param res - Emits the settings.
     */
    getSettings = async (_req: Request, res: Response): Promise<void> => {
        try {
            res.json(await this.service.getSettings());
        } catch (error) {
            this.fail(res, 500, 'Failed to read price-history settings', error);
        }
    };

    /**
     * PATCH /settings — merge pacing settings.
     *
     * @param req - Body carries a partial settings object.
     * @param res - Emits the merged settings.
     */
    updateSettings = async (req: Request, res: Response): Promise<void> => {
        try {
            res.json(await this.service.updateSettings(req.body ?? {}));
        } catch (error) {
            this.fail(res, 400, 'Failed to update price-history settings', error);
        }
    };

    /**
     * POST /backfill/run — advance the backward backfill one bounded slice now.
     *
     * @param _req - Unused.
     * @param res - 202 with `{ started: true }`.
     */
    runBackfill = async (_req: Request, res: Response): Promise<void> => {
        try {
            await this.service.runBackfillTick();
            res.status(202).json({ started: true });
        } catch (error) {
            this.fail(res, 500, 'Failed to run price-history backfill tick', error);
        }
    };

    /**
     * POST /forward/run — append the latest closed day for every tracked asset now.
     *
     * @param _req - Unused.
     * @param res - 202 with `{ started: true }`.
     */
    runForward = async (_req: Request, res: Response): Promise<void> => {
        try {
            await this.service.runForwardTick();
            res.status(202).json({ started: true });
        } catch (error) {
            this.fail(res, 500, 'Failed to run price-history forward tick', error);
        }
    };

    /**
     * GET /diagnostics — held tokens joined against price coverage. Surfaces the
     * tokens users hold that the series cannot price (excluded from USD totals),
     * the operator's actionable list. Degrades to "no held tokens" when
     * account-history is unavailable.
     *
     * @param _req - Unused.
     * @param res - Emits an `IPriceCoverageDiagnostics`.
     */
    getDiagnostics = async (_req: Request, res: Response): Promise<void> => {
        try {
            const accountHistory = this.serviceRegistry.get<IAccountHistoryService>('account-history');
            const held = accountHistory ? await accountHistory.getHeldTokenAssets() : [];
            const stats = await this.service.getStats();
            const pricedSet = new Set(stats.assets.filter((asset) => asset.recentSeeded).map((asset) => asset.asset));
            const unpricedTokens = held.filter((asset) => !pricedSet.has(asset));
            const diagnostics: IPriceCoverageDiagnostics = {
                heldTokenCount: held.length,
                pricedTokenCount: held.length - unpricedTokens.length,
                unpricedTokens
            };
            res.json(diagnostics);
        } catch (error) {
            this.fail(res, 500, 'Failed to compute coverage diagnostics', error);
        }
    };

    /**
     * Log and emit a uniform error response.
     *
     * @param res - The response to write.
     * @param status - HTTP status.
     * @param error - Operator-facing summary.
     * @param cause - The underlying error.
     */
    private fail(res: Response, status: number, error: string, cause: unknown): void {
        this.logger.error({ error: cause }, error);
        res.status(status).json({ error, message: cause instanceof Error ? cause.message : 'Unknown error' });
    }
}
