/**
 * @fileoverview Public HTTP handlers that serve a CMS page in a language when
 * the site asks for it with `?language=`.
 *
 * The handlers sit in front of the English handlers on the same paths. A
 * request without a `language` query, or with the default language, passes
 * straight through to the English handler, so existing callers see no change.
 *
 * Managing translations is not done here. The translation editor uses the
 * core content translation routes under `/api/admin/content`, which serve
 * every translatable content type.
 *
 * @module backend/modules/pages/api/page-translations.controller
 */

import type { NextFunction, Request, Response } from 'express';
import type { IPageService, IPageTranslationService, ISystemLogService } from '@/types';
import { DEFAULT_LANGUAGE } from '@/types';

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
 * Controller for the translated public page endpoints.
 */
export class PageTranslationsController {
    /**
     * @param translationService - Renders and describes served translations.
     * @param pageService - Resolves an old slug to the page it redirects to.
     * @param logger - Scoped logger.
     */
    constructor(
        private readonly translationService: IPageTranslationService,
        private readonly pageService: IPageService,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Render the translation of the page at a slug, following a redirect from
     * an old slug the way the English render does. Passes the request on to
     * the English handler when it asks for no language or the default one.
     *
     * A page without a published, live translation into the language is a
     * 404, never the English body: serving English text under a translated
     * address and `<html lang>` is what translations exist to prevent.
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
