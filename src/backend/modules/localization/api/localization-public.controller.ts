/**
 * @fileoverview Public HTTP surface of the localization module.
 *
 * Two reads serve every page render: the snapshot of live languages and
 * routes, which the Next.js middleware polls, and the translation catalog for
 * the language being rendered. Neither needs authentication, because both hold
 * only what visitors are about to see anyway. The third route accepts the keys
 * the frontend server reports and is refused to anything but the frontend
 * container, because it writes to storage. The fourth counts language switcher
 * clicks; it comes straight from visitors' browsers, so it is public and
 * relies on validation in the service and a rate limit on the route.
 */

import type { Request, Response } from 'express';
import type { IHttpRequest, ILocalizationService, ISystemLogService, ITrafficIgnoreList } from '@/types';
import { LANGUAGE_CODE_PATTERN } from '@/types';
import type { TranslationObservationService } from '../services/translation-observation.service.js';
import type { LanguageSwitchService } from '../services/language-switch.service.js';
import { isInternalServiceRequest } from './isInternalServiceRequest.js';

/**
 * Seconds a cache may hold the config and catalog responses. Matches the
 * middleware's own refresh interval, so an edit goes live within this long
 * whichever cache a request passes through.
 */
const PUBLIC_MAX_AGE_SECONDS = 60;

/**
 * Handlers for `GET /config`, `GET /catalog/:language`, `POST /observations`,
 * and `POST /switches`.
 */
export class LocalizationPublicController {
    /**
     * @param service - Read side of the module.
     * @param observations - Intake for reported keys.
     * @param switches - Counter for language switcher clicks.
     * @param getIgnoreList - Looks up the traffic module's ignore list per
     *   request, so clicks from the operator and their staff are left out the
     *   same way `/system/traffic` leaves them out. Returns null when the
     *   traffic module has not published it, in which case nobody is skipped.
     * @param logger - Module-scoped logger for failures.
     */
    constructor(
        private readonly service: ILocalizationService,
        private readonly observations: TranslationObservationService,
        private readonly switches: LanguageSwitchService,
        private readonly getIgnoreList: () => ITrafficIgnoreList | null,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * GET /config — the live languages and the routes published in them.
     */
    getConfig = async (_req: Request, res: Response): Promise<void> => {
        try {
            const config = await this.service.getPublicConfig();
            res.set('Cache-Control', `public, max-age=${PUBLIC_MAX_AGE_SECONDS}`);
            res.json(config);
        } catch (error) {
            this.logger.error({ error }, 'Failed to load localization config');
            res.status(500).json({ error: 'Failed to load localization config' });
        }
    };

    /**
     * GET /catalog/:language — every translation for one language.
     */
    getCatalog = async (req: Request, res: Response): Promise<void> => {
        const language = req.params.language;
        if (typeof language !== 'string' || !LANGUAGE_CODE_PATTERN.test(language)) {
            res.status(400).json({ error: 'Invalid language code' });
            return;
        }
        try {
            const catalog = await this.service.getCatalog(language);
            res.set('Cache-Control', `public, max-age=${PUBLIC_MAX_AGE_SECONDS}`);
            res.json(catalog);
        } catch (error) {
            this.logger.error({ error, language }, 'Failed to load translation catalog');
            res.status(500).json({ error: 'Failed to load translation catalog' });
        }
    };

    /**
     * POST /observations — keys the frontend server rendered. Body:
     * `{ observations: ITranslationObservation[] }`. Answers 204 with no body,
     * because the frontend sends and forgets.
     */
    postObservations = async (req: Request, res: Response): Promise<void> => {
        if (!isInternalServiceRequest(req)) {
            res.status(403).json({ error: 'Observations are accepted only from the frontend server' });
            return;
        }
        const observations = req.body?.observations;
        if (!Array.isArray(observations)) {
            res.status(400).json({ error: 'Body must be { observations: [...] }' });
            return;
        }
        try {
            const result = await this.observations.record(observations);
            if (result.rejected > 0) {
                this.logger.debug(result, 'Some translation observations were rejected');
            }
            res.status(204).end();
        } catch (error) {
            this.logger.error({ error }, 'Failed to record translation observations');
            res.status(500).json({ error: 'Failed to record translation observations' });
        }
    };

    /**
     * POST /switches — one language switcher click. Body: `ILanguageSwitch`.
     * Answers 204 whether or not the click was counted, because the browser
     * sends it with `sendBeacon` while the next page loads and never reads the
     * reply. A click from an ignored visitor is not counted.
     */
    postSwitch = async (req: Request, res: Response): Promise<void> => {
        // The ignore list reads the session and the analytics cookie, both of
        // which an Express request carries; IHttpRequest is the framework-free
        // view of the same object that the traffic module's resolver accepts.
        const ignored = this.getIgnoreList()?.isRequestIgnored(req as unknown as IHttpRequest) ?? false;
        try {
            if (!ignored) {
                await this.switches.record(req.body);
            }
            res.status(204).end();
        } catch (error) {
            this.logger.error({ error }, 'Failed to record language switch');
            res.status(500).json({ error: 'Failed to record language switch' });
        }
    };
}
