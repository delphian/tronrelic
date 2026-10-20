/**
 * @fileoverview Public HTTP surface of the consent module.
 *
 * The config read serves every page render: the Next.js middleware polls it
 * to decide whether to set the analytics cookie, and the root layout reads it
 * to decide whether to show the banner and load the Google Ads tag. It holds
 * nothing secret. The page-view route comes straight from visitors' browsers,
 * so it is public and relies on a rate limit on the route.
 */

import type { Request, Response } from 'express';
import type { IConsentService, IHttpRequest, ISystemLogService, ITrafficIgnoreList } from '@/types';
import { CONSENT_COOKIE_NAME } from '@/types';
import type { AnonymousPageviewService } from '../services/anonymous-pageview.service.js';

/**
 * Seconds a cache may hold the config response. Matches the middleware's own
 * refresh interval, so a saved change goes live within this long whichever
 * cache a request passes through.
 */
const PUBLIC_MAX_AGE_SECONDS = 60;

/**
 * Read one request header as a single string.
 *
 * @param value - The raw header, which Express types as a string or a list.
 * @returns The first value, or undefined when absent.
 */
function headerValue(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
}

/**
 * Handlers for `GET /config` and `POST /pageviews`.
 */
export class ConsentPublicController {
    /**
     * @param service - Settings and consent resolution.
     * @param pageviews - Counter for page views without analytics consent.
     * @param getIgnoreList - Looks up the traffic module's ignore list per
     *   request, so page views from the operator and their staff are left out
     *   the same way `/system/traffic` leaves them out. Returns null when the
     *   traffic module has not published it, in which case nobody is skipped.
     * @param logger - Module-scoped logger for failures.
     */
    constructor(
        private readonly service: IConsentService,
        private readonly pageviews: AnonymousPageviewService,
        private readonly getIgnoreList: () => ITrafficIgnoreList | null,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * GET /config — the settings every request needs.
     */
    getConfig = async (_req: Request, res: Response): Promise<void> => {
        try {
            const config = await this.service.getPublicConfig();
            res.set('Cache-Control', `public, max-age=${PUBLIC_MAX_AGE_SECONDS}`);
            res.json(config);
        } catch (error) {
            this.logger.error({ error }, 'Failed to load consent config');
            res.status(500).json({ error: 'Failed to load consent config' });
        }
    };

    /**
     * POST /pageviews — one page view from a visitor without analytics
     * consent. Body: `{ automated?: boolean }`. Answers 204 whether or not it
     * was counted, because the browser sends it with `sendBeacon` and never
     * reads the reply.
     *
     * The request is counted only when its own consent state says analytics
     * is not allowed, whether because a visitor in a consent region has not
     * agreed or because a visitor anywhere opted out. A visitor with analytics
     * consent is already counted by the traffic module, so counting them here
     * as well would double them.
     */
    postPageview = async (req: Request, res: Response): Promise<void> => {
        try {
            const state = await this.service.resolveRequest(
                headerValue(req.headers['cf-ipcountry']),
                req.cookies?.[CONSENT_COOKIE_NAME]
            );
            // The ignore list reads the session and the analytics cookie, both
            // of which an Express request carries; IHttpRequest is the
            // framework-free view of the same object the resolver accepts.
            const ignored = this.getIgnoreList()?.isRequestIgnored(req as unknown as IHttpRequest) ?? false;
            if (!state.analytics && !ignored) {
                await this.pageviews.record(req.body);
            }
            res.status(204).end();
        } catch (error) {
            this.logger.error({ error }, 'Failed to record anonymous page view');
            res.status(500).json({ error: 'Failed to record anonymous page view' });
        }
    };
}
