/**
 * @fileoverview Admin HTTP surface behind `/system/consent`.
 *
 * A thin wrapper by design: each handler reads the request, names the actor,
 * and delegates to a service, which owns every rule. The `requireAdmin` gate
 * and rate limiter are applied where the module mounts the router.
 */

import type { Request, Response } from 'express';
import type { ISystemLogService } from '@/types';
import { actorFromAdminRequest } from '../../../services/content-actor.js';
import type { ConsentService } from '../services/consent.service.js';
import type { AnonymousPageviewService } from '../services/anonymous-pageview.service.js';
import { DEFAULT_PAGEVIEW_STATS_DAYS } from '../services/anonymous-pageview.service.js';
import { ConsentValidationError } from '../services/consent-errors.js';

/**
 * Read a query value as a number.
 *
 * @param value - Raw `req.query` entry.
 * @returns The number, or undefined when absent or not numeric.
 */
function queryNumber(value: unknown): number | undefined {
    const parsed = typeof value === 'string' ? Number(value) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Handlers for the settings, the renew action, and the anonymous page view figures.
 */
export class ConsentAdminController {
    /**
     * @param service - Settings storage.
     * @param pageviews - Anonymous page view counter.
     * @param logger - Module-scoped logger for unexpected failures.
     */
    constructor(
        private readonly service: ConsentService,
        private readonly pageviews: AnonymousPageviewService,
        private readonly logger: ISystemLogService
    ) {}

    /** GET /settings — the current settings and who saved them last. */
    getSettings = async (_req: Request, res: Response): Promise<void> => {
        await this.handle(res, 'Failed to load consent settings', async () => {
            res.json({ settings: await this.service.getSettings() });
        });
    };

    /** PATCH /settings — change the main switch, Google Ads id, or conversion label. Body: `{ enabled?, googleAdsId?, conversionLabel? }`. */
    updateSettings = async (req: Request, res: Response): Promise<void> => {
        await this.handle(res, 'Failed to save consent settings', async () => {
            const settings = await this.service.updateSettings(req.body ?? {}, actorFromAdminRequest(req).id);
            res.json({ settings });
        });
    };

    /** POST /settings/renew — raise the policy version so visitors in consent regions are asked again. */
    renewConsent = async (req: Request, res: Response): Promise<void> => {
        await this.handle(res, 'Failed to renew consent', async () => {
            res.json({ settings: await this.service.renewConsent(actorFromAdminRequest(req).id) });
        });
    };

    /** GET /pageviews — anonymous page views over `?days=` whole UTC days (default 30, at most 365). */
    getPageviewStats = async (req: Request, res: Response): Promise<void> => {
        await this.handle(res, 'Failed to load anonymous page views', async () => {
            res.json(await this.pageviews.getStats(queryNumber(req.query.days) ?? DEFAULT_PAGEVIEW_STATS_DAYS));
        });
    };

    /**
     * Run a handler body and translate the service's error classes into
     * status codes, so each handler states only its happy path.
     *
     * @param res - Response to write a failure to.
     * @param message - Message logged and returned for an unexpected failure.
     * @param body - The handler's work.
     */
    private async handle(res: Response, message: string, body: () => Promise<void>): Promise<void> {
        try {
            await body();
        } catch (error) {
            if (error instanceof ConsentValidationError) {
                res.status(400).json({ error: error.message });
            } else {
                this.logger.error({ error }, message);
                res.status(500).json({ error: message });
            }
        }
    }
}
