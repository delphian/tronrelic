import { Router } from 'express';
import type { PagesController } from './pages.controller.js';
import type { PageTranslationsController } from './page-translations.controller.js';
import { createRateLimiter } from '../../../api/middleware/rate-limit.js';

/**
 * Create the Pages admin router. Mounted at `/api/admin/pages` with
 * `requireAdmin` middleware. Static routes (`/preview`, `/settings`) come
 * before `/:id` so the dynamic page-id parameter does not capture them.
 * `:id` is the page's core content id.
 *
 * A page's translations live under `/:id/translations`, addressed by language
 * code, because a page has at most one translation per language.
 *
 * File endpoints used to live here under `/files/*` — they moved to the
 * Files module's router at `/api/admin/files`.
 *
 * @param controller - The pages controller the page routes bind to.
 * @param translations - The controller the translation routes bind to.
 * @returns The admin router.
 */
export function createPagesRouter(controller: PagesController, translations: PageTranslationsController): Router {
    const router = Router();

    router.get('/', controller.listPages.bind(controller));
    router.post('/', controller.createPage.bind(controller));

    router.post('/preview', controller.previewMarkdown.bind(controller));
    router.get('/settings', controller.getSettings.bind(controller));
    router.patch('/settings', controller.updateSettings.bind(controller));

    router.get('/:id', controller.getPage.bind(controller));
    router.patch('/:id', controller.updatePage.bind(controller));
    router.delete('/:id', controller.deletePage.bind(controller));
    router.post('/:id/restore', controller.restorePage.bind(controller));

    router.get('/:id/translations', translations.listTranslations.bind(translations));
    router.post('/:id/translations', translations.createTranslation.bind(translations));
    router.patch('/:id/translations/:language', translations.updateTranslation.bind(translations));
    router.delete('/:id/translations/:language', translations.deleteTranslation.bind(translations));
    router.post('/:id/translations/:language/restore', translations.restoreTranslation.bind(translations));
    // Each suggestion is a paid model call, so it carries its own ceiling on
    // top of the admin limiter, matching the localization Suggest route.
    router.post(
        '/:id/translations/:language/suggest',
        createRateLimiter({ windowSeconds: 60, maxRequests: 20, keyPrefix: 'pages-translation-suggestions' }),
        translations.suggestTranslation.bind(translations)
    );

    return router;
}
