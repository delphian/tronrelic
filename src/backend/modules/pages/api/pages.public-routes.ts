import { Router } from 'express';
import type { PagesController } from './pages.controller.js';
import type { PageTranslationsController } from './page-translations.controller.js';

/**
 * Create Express router for public pages module endpoints.
 *
 * These routes do not require authentication and are accessible to all users.
 * Routes are mounted at /api/pages.
 *
 * Each path has two handlers. The translation handler runs first and answers
 * a request carrying `?language=<code>` for a language other than English; any
 * other request passes on to the English handler unchanged.
 *
 * @param controller - Pages controller instance
 * @param translations - Translation controller, which answers translated requests
 * @returns Express router with public endpoints registered
 */
export function createPublicPagesRouter(controller: PagesController, translations: PageTranslationsController): Router {
    const router = Router();

    /**
     * GET /api/pages/:slug/render
     * Get rendered HTML for a published page, or its translation with ?language=
     *
     * Note: This must come before /:slug to avoid route conflicts
     */
    router.get(
        '/:slug/render',
        translations.renderPublicTranslation.bind(translations),
        controller.renderPublicPage.bind(controller)
    );

    /**
     * GET /api/pages/:slug
     * Get published page metadata by slug, or its translation's with ?language=
     */
    router.get(
        '/:slug',
        translations.getPublicTranslation.bind(translations),
        controller.getPublicPage.bind(controller)
    );

    return router;
}
