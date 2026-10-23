/**
 * @fileoverview HTTP handlers for CMS page translations: the admin endpoints
 * the `/system/pages` editor uses, and the public handlers that serve a page in
 * a language when the site asks for it with `?language=`.
 *
 * The public handlers sit in front of the English handlers on the same paths.
 * A request without a `language` query, or with the default language, passes
 * straight through to the English handler, so existing callers see no change.
 *
 * @module backend/modules/pages/api/page-translations.controller
 */

import type { NextFunction, Request, Response } from 'express';
import type { IPageService, IPageTranslationService, ISystemLogService } from '@/types';
import { DEFAULT_LANGUAGE } from '@/types';
import { actorFromAdminRequest } from '../../../services/content-actor.js';
import { isContentError } from '../../../services/content-error.js';
import { CONTENT_ERROR_STATUS, sendContentWriteError } from './sendContentWriteError.js';
import type { PageTranslationSuggestionService } from '../services/page-translation-suggestion.service.js';
import { PageTranslationProviderError, PageTranslationUnavailableError } from '../services/page-translation-errors.js';

/**
 * Read the language a public request asks for.
 *
 * @param req - The request, whose `language` query is optional.
 * @returns The language code, or null when the request wants the English page.
 */
function requestedLanguage(req: Request): string | null {
    const language = typeof req.query.language === 'string' ? req.query.language : '';

    return language && language !== DEFAULT_LANGUAGE ? language : null;
}

/**
 * Turn a route's slug parameter into a page slug.
 *
 * @param slug - The decoded `:slug` parameter.
 * @returns The slug with its leading `/`.
 */
function normalizeSlug(slug: string): string {
    return slug.startsWith('/') ? slug : `/${slug}`;
}

/**
 * Controller for page translation endpoints.
 */
export class PageTranslationsController {
    /**
     * @param translationService - Translation management and public reads.
     * @param pageService - Resolves an old slug to the page it redirects to.
     * @param suggestionService - Runs the AI Suggest request for the editor.
     * @param logger - Scoped logger.
     */
    constructor(
        private readonly translationService: IPageTranslationService,
        private readonly pageService: IPageService,
        private readonly suggestionService: Pick<PageTranslationSuggestionService, 'suggest'>,
        private readonly logger: ISystemLogService
    ) {}

    // ============================================================================
    // Admin endpoints
    // ============================================================================

    /**
     * List a page's translations, including soft-deleted ones, together with
     * the English text they are written against, so the editor shows and
     * starts drafts from the same text the stale flags are computed from.
     *
     * @param req - Params: `id`, the page's core content id.
     * @param res - Receives `{ translations, source }`.
     */
    async listTranslations(req: Request, res: Response): Promise<void> {
        try {
            const [translations, source] = await Promise.all([
                this.translationService.listTranslations(req.params.id),
                this.translationService.getTranslationSource(req.params.id)
            ]);
            res.json({ translations, source });
        } catch (error) {
            // A read has no validation step, so anything but a content
            // refusal (an unknown page id) is a server failure.
            this.logger.error({ error, pageId: req.params.id }, 'Failed to list page translations');
            res.status(isContentError(error) ? CONTENT_ERROR_STATUS[error.code] : 500).json({
                error: 'Failed to list page translations',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Create a page's translation into one language.
     *
     * @param req - Params: `id`. Body: `{ language, content }`.
     * @param res - Receives `{ translation }` (201).
     */
    async createTranslation(req: Request, res: Response): Promise<void> {
        try {
            const { language, content } = req.body ?? {};
            if (typeof language !== 'string' || typeof content !== 'string' || !content.trim()) {
                res.status(400).json({ error: 'Language and content are required' });
                return;
            }
            const translation = await this.translationService.createTranslation(
                req.params.id,
                language,
                content,
                actorFromAdminRequest(req)
            );
            res.status(201).json({ translation });
        } catch (error) {
            this.logger.error({ error, pageId: req.params.id }, 'Failed to create page translation');
            sendContentWriteError(res, 'Failed to create page translation', error);
        }
    }

    /**
     * Replace a translation's markdown.
     *
     * @param req - Params: `id`, `language`. Body: `{ content }`.
     * @param res - Receives `{ translation }`.
     */
    async updateTranslation(req: Request, res: Response): Promise<void> {
        try {
            const { content } = req.body ?? {};
            if (typeof content !== 'string' || !content.trim()) {
                res.status(400).json({ error: 'Content is required' });
                return;
            }
            const translation = await this.translationService.updateTranslation(
                req.params.id,
                req.params.language,
                content,
                actorFromAdminRequest(req)
            );
            res.json({ translation });
        } catch (error) {
            this.logger.error({ error, pageId: req.params.id, language: req.params.language }, 'Failed to update page translation');
            sendContentWriteError(res, 'Failed to update page translation', error);
        }
    }

    /**
     * Soft-delete a translation.
     *
     * @param req - Params: `id`, `language`.
     * @param res - Receives 204.
     */
    async deleteTranslation(req: Request, res: Response): Promise<void> {
        try {
            await this.translationService.deleteTranslation(req.params.id, req.params.language, actorFromAdminRequest(req));
            res.status(204).send();
        } catch (error) {
            this.logger.error({ error, pageId: req.params.id, language: req.params.language }, 'Failed to delete page translation');
            sendContentWriteError(res, 'Failed to delete page translation', error);
        }
    }

    /**
     * Restore a soft-deleted translation.
     *
     * @param req - Params: `id`, `language`.
     * @param res - Receives `{ translation }`.
     */
    async restoreTranslation(req: Request, res: Response): Promise<void> {
        try {
            const translation = await this.translationService.restoreTranslation(
                req.params.id,
                req.params.language,
                actorFromAdminRequest(req)
            );
            res.json({ translation });
        } catch (error) {
            this.logger.error({ error, pageId: req.params.id, language: req.params.language }, 'Failed to restore page translation');
            sendContentWriteError(res, 'Failed to restore page translation', error);
        }
    }

    /**
     * Ask the AI model to translate the page into a language and return the
     * markdown for the editor. Nothing is saved.
     *
     * @param req - Params: `id`, `language`.
     * @param res - Receives `IPageTranslationSuggestionResult`; 503 when no
     *   provider can run it, 502 when the model's answer cannot be used.
     */
    async suggestTranslation(req: Request, res: Response): Promise<void> {
        try {
            const result = await this.suggestionService.suggest(
                req.params.id,
                req.params.language,
                actorFromAdminRequest(req).id
            );
            res.json(result);
        } catch (error) {
            let status = 400;
            if (error instanceof PageTranslationUnavailableError) {
                status = 503;
            } else if (error instanceof PageTranslationProviderError) {
                status = 502;
            } else if (isContentError(error)) {
                status = CONTENT_ERROR_STATUS[error.code];
            }
            this.logger.warn({ error, pageId: req.params.id, language: req.params.language }, 'Failed to suggest page translation');
            res.status(status).json({
                error: 'Failed to suggest translation',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    // ============================================================================
    // Public endpoints (no auth required)
    // ============================================================================

    /**
     * Render the translation of the page at a slug, following a redirect from
     * an old slug the way the English render does. Passes the request on to
     * the English handler when it asks for no language or the default one.
     *
     * A page without a visible, published translation into the language is a
     * 404, never the English body: serving English text under a translated
     * address and `<html lang>` is what this feature exists to prevent.
     *
     * @param req - Params: `slug`. Query: `language`.
     * @param res - Receives the render plus `currentSlug` and `requestedSlug`, or 404.
     * @param next - Continues to the English handler.
     */
    async renderPublicTranslation(req: Request, res: Response, next: NextFunction): Promise<void> {
        const language = requestedLanguage(req);
        if (!language) {
            next();
            return;
        }
        try {
            const requestedSlug = normalizeSlug(req.params.slug);
            let currentSlug = requestedSlug;
            let rendered = await this.translationService.renderPublicTranslation(requestedSlug, language);
            if (!rendered) {
                const redirectPage = await this.pageService.findPublicPageByOldSlug(requestedSlug);
                if (redirectPage) {
                    rendered = await this.translationService.renderPublicTranslation(redirectPage.slug, language);
                    currentSlug = redirectPage.slug;
                }
            }

            if (rendered) {
                res.json({ ...rendered, currentSlug, requestedSlug });
            } else {
                res.status(404).json({ error: 'Page not found' });
            }
        } catch (error) {
            // The caller is anonymous, so the response names no internal
            // detail; the log keeps the error for operators.
            this.logger.error({ error, slug: req.params.slug, language }, 'Failed to render public page translation');
            res.status(500).json({ error: 'Failed to render page' });
        }
    }

    /**
     * Get the public metadata of the translation of the page at a slug, or of
     * the page an old slug redirects to. Passes the request on to the English
     * handler when it asks for no language or the default one.
     *
     * @param req - Params: `slug`. Query: `language`.
     * @param res - Receives `{ page, requestedSlug }`, or 404.
     * @param next - Continues to the English handler.
     */
    async getPublicTranslation(req: Request, res: Response, next: NextFunction): Promise<void> {
        const language = requestedLanguage(req);
        if (!language) {
            next();
            return;
        }
        try {
            const requestedSlug = normalizeSlug(req.params.slug);
            let page = await this.translationService.getPublicTranslationMetadata(requestedSlug, language);
            if (!page) {
                const redirectPage = await this.pageService.findPublicPageByOldSlug(requestedSlug);
                page = redirectPage
                    ? await this.translationService.getPublicTranslationMetadata(redirectPage.slug, language)
                    : null;
            }

            if (page) {
                res.json({ page, requestedSlug });
            } else {
                res.status(404).json({ error: 'Page not found' });
            }
        } catch (error) {
            this.logger.error({ error, slug: req.params.slug, language }, 'Failed to get public page translation');
            res.status(500).json({ error: 'Failed to get page' });
        }
    }
}
