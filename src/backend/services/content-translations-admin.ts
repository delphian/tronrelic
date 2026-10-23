/**
 * @fileoverview Admin HTTP surface for content translations, mounted at
 * `/api/admin/content` behind `requireAdmin`.
 *
 * The translation editor serves every translatable content type, so its routes
 * belong to core rather than to the module or plugin that owns the content.
 * The handlers only translate HTTP: they read the request, call
 * `IContentTranslationService`, and map a refusal to a status. A signed-in
 * admin is a curator and may change translations; the shared service token is
 * not, and is refused with 403, because translations are not reviewed.
 *
 * @module backend/services/content-translations-admin
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { IContentTranslationService, ISystemLogService } from '@/types';
import { createRateLimiter } from '../api/middleware/rate-limit.js';
import { actorFromAdminRequest } from './content-actor.js';
import { isContentError } from './content-error.js';
import { CONTENT_ERROR_STATUS, sendContentWriteError } from './content-http.js';
import { ContentTranslationProviderError, ContentTranslationUnavailableError } from './content-translation-errors.js';

/**
 * Controller for the content translation admin routes.
 */
export class ContentTranslationsController {
    /**
     * @param translations - The core content translation service.
     * @param logger - Scoped logger.
     */
    constructor(
        private readonly translations: IContentTranslationService,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Load an item's English source and every translation of it.
     *
     * @param req - Params: `typeId`, `id`.
     * @param res - Receives `IContentTranslationOverview`.
     */
    getOverview = async (req: Request, res: Response): Promise<void> => {
        try {
            res.json(await this.translations.getOverview(req.params.typeId, req.params.id));
        } catch (error) {
            // A read has no validation step, so anything but a content
            // refusal is a server failure.
            this.logger.error({ error, typeId: req.params.typeId, id: req.params.id }, 'Failed to load content translations');
            res.status(isContentError(error) ? CONTENT_ERROR_STATUS[error.code] : 500).json({
                error: 'Failed to load translations',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }

        return;
    };

    /**
     * Create or replace one translation.
     *
     * @param req - Params: `typeId`, `id`, `language`. Body: `{ values, published }`.
     * @param res - Receives `{ translation }`.
     */
    saveTranslation = async (req: Request, res: Response): Promise<void> => {
        try {
            const body = req.body ?? {};
            const translation = await this.translations.saveTranslation(
                req.params.typeId,
                req.params.id,
                req.params.language,
                { values: body.values, published: body.published === true },
                actorFromAdminRequest(req)
            );
            res.json({ translation });
        } catch (error) {
            this.logger.warn({ error, ...req.params }, 'Failed to save content translation');
            sendContentWriteError(res, 'Failed to save translation', error);
        }

        return;
    };

    /**
     * Soft-delete one translation.
     *
     * @param req - Params: `typeId`, `id`, `language`.
     * @param res - Receives 204.
     */
    deleteTranslation = async (req: Request, res: Response): Promise<void> => {
        try {
            await this.translations.deleteTranslation(req.params.typeId, req.params.id, req.params.language, actorFromAdminRequest(req));
            res.status(204).send();
        } catch (error) {
            this.logger.warn({ error, ...req.params }, 'Failed to delete content translation');
            sendContentWriteError(res, 'Failed to delete translation', error);
        }

        return;
    };

    /**
     * Restore one soft-deleted translation.
     *
     * @param req - Params: `typeId`, `id`, `language`.
     * @param res - Receives `{ translation }`.
     */
    restoreTranslation = async (req: Request, res: Response): Promise<void> => {
        try {
            const translation = await this.translations.restoreTranslation(
                req.params.typeId,
                req.params.id,
                req.params.language,
                actorFromAdminRequest(req)
            );
            res.json({ translation });
        } catch (error) {
            this.logger.warn({ error, ...req.params }, 'Failed to restore content translation');
            sendContentWriteError(res, 'Failed to restore translation', error);
        }

        return;
    };

    /**
     * Ask the AI model for a translation. Nothing is saved.
     *
     * @param req - Params: `typeId`, `id`, `language`.
     * @param res - Receives `IContentTranslationSuggestion`; 503 when no
     *   provider can run it, 502 when the model's answer cannot be used.
     */
    suggestTranslation = async (req: Request, res: Response): Promise<void> => {
        try {
            res.json(await this.translations.suggestTranslation(
                req.params.typeId,
                req.params.id,
                req.params.language,
                actorFromAdminRequest(req)
            ));
        } catch (error) {
            let status = 400;
            if (error instanceof ContentTranslationUnavailableError) {
                status = 503;
            } else if (error instanceof ContentTranslationProviderError) {
                status = 502;
            } else if (isContentError(error)) {
                status = CONTENT_ERROR_STATUS[error.code];
            }
            this.logger.warn({ error, ...req.params }, 'Failed to suggest content translation');
            res.status(status).json({
                error: 'Failed to suggest translation',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }

        return;
    };

    /**
     * Read the AI settings for translation suggestions.
     *
     * @param _req - Unused.
     * @param res - Receives `{ settings }`.
     */
    getSettings = async (_req: Request, res: Response): Promise<void> => {
        try {
            res.json({ settings: await this.translations.getSettings() });
        } catch (error) {
            this.logger.error({ error }, 'Failed to read content translation settings');
            res.status(500).json({ error: 'Failed to read settings' });
        }

        return;
    };

    /**
     * Change the AI settings for translation suggestions.
     *
     * @param req - Body: `{ systemPrompt?, providerId?, model? }`.
     * @param res - Receives `{ settings }`; 400 for an invalid value.
     */
    updateSettings = async (req: Request, res: Response): Promise<void> => {
        try {
            const { systemPrompt, providerId, model } = req.body ?? {};
            res.json({ settings: await this.translations.updateSettings({ systemPrompt, providerId, model }) });
        } catch (error) {
            this.logger.warn({ error }, 'Failed to update content translation settings');
            res.status(400).json({
                error: 'Failed to update settings',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }

        return;
    };
}

/**
 * Build the admin router. Admin authentication is applied at mount time by
 * the caller, as for the other core admin routers, so the factory stays usable
 * from tests without the auth middleware. `/translation-settings` is declared
 * before the `/:typeId/...` routes so a type id can never capture it.
 *
 * @param controller - Controller bound to the content translation service.
 * @returns The router.
 */
export function createContentTranslationsAdminRouter(controller: ContentTranslationsController): Router {
    const router = Router();

    router.get('/translation-settings', controller.getSettings);
    router.patch('/translation-settings', controller.updateSettings);

    router.get('/:typeId/:id/translations', controller.getOverview);
    router.put('/:typeId/:id/translations/:language', controller.saveTranslation);
    router.delete('/:typeId/:id/translations/:language', controller.deleteTranslation);
    router.post('/:typeId/:id/translations/:language/restore', controller.restoreTranslation);
    // Each suggestion is a paid model call, so it carries its own ceiling on
    // top of the admin limiter, matching the localization Suggest route.
    router.post(
        '/:typeId/:id/translations/:language/suggest',
        createRateLimiter({ windowSeconds: 60, maxRequests: 20, keyPrefix: 'content-translation-suggestions' }),
        controller.suggestTranslation
    );

    return router;
}
