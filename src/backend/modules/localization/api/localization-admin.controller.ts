/**
 * @fileoverview Admin HTTP surface behind `/system/localization`.
 *
 * A thin wrapper by design: each handler reads the request, names the actor,
 * and delegates to `LocalizationAdminService`, which owns every rule. The
 * `requireAdmin` gate and rate limiter are applied where the module mounts the
 * router.
 */

import type { Request, Response } from 'express';
import type { ISystemLogService, TranslationStatus } from '@/types';
import { actorFromAdminRequest } from '../../../services/content-actor.js';
import type { LocalizationAdminService } from '../services/localization-admin.service.js';
import type { LocalizationSettingsService } from '../services/localization-settings.service.js';
import type { TranslationSuggestionService } from '../services/translation-suggestion.service.js';
import type { LanguageSwitchService } from '../services/language-switch.service.js';
import { DEFAULT_SWITCH_STATS_DAYS } from '../services/language-switch.service.js';
import {
    LocalizationConflictError,
    LocalizationNotFoundError,
    LocalizationProviderError,
    LocalizationUnavailableError,
    LocalizationValidationError
} from '../services/localization-errors.js';

/** Status values the listing filter accepts. */
const STATUSES: ReadonlyArray<TranslationStatus> = ['missing', 'stale', 'translated'];

/**
 * Read a query value as a string.
 *
 * @param value - Raw `req.query` entry.
 * @returns The string, or undefined when absent or repeated.
 */
function queryString(value: unknown): string | undefined {
    return typeof value === 'string' && value !== '' ? value : undefined;
}

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
 * Handlers for languages, routes, keys, translations, settings, AI
 * translation suggestions, and language switcher usage.
 */
export class LocalizationAdminController {
    /**
     * @param service - Write side of the module.
     * @param settings - Storage for the system prompt, provider, and model.
     * @param suggestions - Runs AI translation requests for the Translations tab.
     * @param switches - Summarises language switcher clicks for the Switches tab.
     * @param logger - Module-scoped logger for unexpected failures.
     */
    constructor(
        private readonly service: LocalizationAdminService,
        private readonly settings: LocalizationSettingsService,
        private readonly suggestions: TranslationSuggestionService,
        private readonly switches: LanguageSwitchService,
        private readonly logger: ISystemLogService
    ) {}

    /** GET /languages — configured languages with progress counts. */
    listLanguages = async (_req: Request, res: Response): Promise<void> => {
        await this.handle(res, 'Failed to list languages', async () => {
            res.json({ languages: await this.service.listLanguages() });
        });
    };

    /** POST /languages — add a language. Body: `{ code, name, nativeName, direction? }`. */
    createLanguage = async (req: Request, res: Response): Promise<void> => {
        await this.handle(res, 'Failed to add language', async () => {
            const language = await this.service.createLanguage(req.body ?? {}, actorFromAdminRequest(req).id);
            res.status(201).json({ language });
        });
    };

    /** PATCH /languages/:code — rename, change direction, or enable/disable. */
    updateLanguage = async (req: Request, res: Response): Promise<void> => {
        await this.handle(res, 'Failed to update language', async () => {
            const language = await this.service.updateLanguage(req.params.code, req.body ?? {}, actorFromAdminRequest(req).id);
            res.json({ language });
        });
    };

    /** DELETE /languages/:code — remove a language and its translations. */
    deleteLanguage = async (req: Request, res: Response): Promise<void> => {
        await this.handle(res, 'Failed to delete language', async () => {
            await this.service.deleteLanguage(req.params.code, actorFromAdminRequest(req).id);
            res.status(204).end();
        });
    };

    /** GET /routes — published routes with translation gaps. */
    listRoutes = async (_req: Request, res: Response): Promise<void> => {
        await this.handle(res, 'Failed to list routes', async () => {
            res.json({ routes: await this.service.listRoutes() });
        });
    };

    /** POST /routes — publish a pattern. Body: `{ pattern, languages }`. */
    createRoute = async (req: Request, res: Response): Promise<void> => {
        await this.handle(res, 'Failed to add route', async () => {
            const route = await this.service.createRoute(req.body ?? {}, actorFromAdminRequest(req).id);
            res.status(201).json({ route });
        });
    };

    /** PATCH /routes/:id — change a route's pattern or languages. */
    updateRoute = async (req: Request, res: Response): Promise<void> => {
        await this.handle(res, 'Failed to update route', async () => {
            const route = await this.service.updateRoute(req.params.id, req.body ?? {}, actorFromAdminRequest(req).id);
            res.json({ route });
        });
    };

    /** DELETE /routes/:id — stop publishing a route. */
    deleteRoute = async (req: Request, res: Response): Promise<void> => {
        await this.handle(res, 'Failed to delete route', async () => {
            await this.service.deleteRoute(req.params.id, actorFromAdminRequest(req).id);
            res.status(204).end();
        });
    };

    /** GET /namespaces — namespaces with key counts. */
    listNamespaces = async (_req: Request, res: Response): Promise<void> => {
        await this.handle(res, 'Failed to list namespaces', async () => {
            res.json({ namespaces: await this.service.listNamespaces() });
        });
    };

    /** GET /translations?language=&namespace=&status=&search=&route=&limit=&offset= — paged listing. */
    listTranslations = async (req: Request, res: Response): Promise<void> => {
        await this.handle(res, 'Failed to list translations', async () => {
            const status = queryString(req.query.status);
            const page = await this.service.listTranslations({
                language: queryString(req.query.language) ?? '',
                namespace: queryString(req.query.namespace),
                status: STATUSES.includes(status as TranslationStatus) ? status as TranslationStatus : undefined,
                search: queryString(req.query.search),
                route: queryString(req.query.route),
                limit: queryNumber(req.query.limit),
                offset: queryNumber(req.query.offset)
            });
            res.json(page);
        });
    };

    /** PUT /translations — save one translation. Body: `{ namespace, key, language, text }`. */
    saveTranslation = async (req: Request, res: Response): Promise<void> => {
        await this.handle(res, 'Failed to save translation', async () => {
            const translation = await this.service.saveTranslation(req.body ?? {}, actorFromAdminRequest(req).id);
            res.json({ translation });
        });
    };

    /** PUT /translations/batch — save several translations at once. Body: `{ language, translations: [{ namespace, key, text }] }`. */
    saveTranslations = async (req: Request, res: Response): Promise<void> => {
        await this.handle(res, 'Failed to save translations', async () => {
            const translations = await this.service.saveTranslations(req.body ?? {}, actorFromAdminRequest(req).id);
            res.json({ translations });
        });
    };

    /** DELETE /translations?namespace=&key=&language= — remove one translation. */
    deleteTranslation = async (req: Request, res: Response): Promise<void> => {
        await this.handle(res, 'Failed to delete translation', async () => {
            await this.service.deleteTranslation(
                queryString(req.query.namespace) ?? '',
                queryString(req.query.key) ?? '',
                queryString(req.query.language) ?? '',
                actorFromAdminRequest(req).id
            );
            res.status(204).end();
        });
    };

    /** POST /keys — add a key by hand. Body: `{ namespace, key, source }`. */
    createKey = async (req: Request, res: Response): Promise<void> => {
        await this.handle(res, 'Failed to add key', async () => {
            const key = await this.service.createKey(req.body ?? {}, actorFromAdminRequest(req).id);
            res.status(201).json({ key });
        });
    };

    /** DELETE /keys?namespace=&key= — remove a key and its translations. */
    deleteKey = async (req: Request, res: Response): Promise<void> => {
        await this.handle(res, 'Failed to delete key', async () => {
            await this.service.deleteKey(
                queryString(req.query.namespace) ?? '',
                queryString(req.query.key) ?? '',
                actorFromAdminRequest(req).id
            );
            res.status(204).end();
        });
    };

    /** GET /settings — the system prompt, provider, and model the AI buttons use. */
    getSettings = async (_req: Request, res: Response): Promise<void> => {
        await this.handle(res, 'Failed to load localization settings', async () => {
            res.json({ settings: await this.settings.getSettings() });
        });
    };

    /** PATCH /settings — change the system prompt, provider, or model. Body: `{ systemPrompt?, providerId?, model? }`. */
    updateSettings = async (req: Request, res: Response): Promise<void> => {
        await this.handle(res, 'Failed to save localization settings', async () => {
            const settings = await this.settings.updateSettings(req.body ?? {}, actorFromAdminRequest(req).id);
            res.json({ settings });
        });
    };

    /** POST /translation-suggestions — ask the AI model to translate keys. Body: `{ language, keys: [{ namespace, key }] }`. */
    suggestTranslations = async (req: Request, res: Response): Promise<void> => {
        await this.handle(res, 'Failed to suggest translations', async () => {
            res.json(await this.suggestions.suggest(req.body ?? {}, actorFromAdminRequest(req).id));
        });
    };

    /** GET /switches — language switcher usage over `?days=` whole UTC days (default 30, at most 365). */
    getSwitchStats = async (req: Request, res: Response): Promise<void> => {
        await this.handle(res, 'Failed to load language switch stats', async () => {
            res.json(await this.switches.getStats(queryNumber(req.query.days) ?? DEFAULT_SWITCH_STATS_DAYS));
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
            if (error instanceof LocalizationValidationError) {
                res.status(400).json({ error: error.message });
            } else if (error instanceof LocalizationNotFoundError) {
                res.status(404).json({ error: error.message });
            } else if (error instanceof LocalizationConflictError) {
                res.status(409).json({ error: error.message });
            } else if (error instanceof LocalizationProviderError) {
                res.status(502).json({ error: error.message });
            } else if (error instanceof LocalizationUnavailableError) {
                res.status(503).json({ error: error.message });
            } else {
                this.logger.error({ error }, message);
                res.status(500).json({ error: message });
            }
        }
    }
}
