import { Router } from 'express';
import type { PagesController } from './pages.controller.js';

/**
 * Create the Pages admin router. Mounted at `/api/admin/pages` with
 * `requireAdmin` middleware. Static routes (`/preview`, `/settings`) come
 * before `/:id` so the dynamic page-id parameter does not capture them.
 *
 * File endpoints used to live here under `/files/*` — they moved to the
 * Files module's router at `/api/admin/files`.
 */
export function createPagesRouter(controller: PagesController): Router {
    const router = Router();

    router.get('/', controller.listPages.bind(controller));
    router.post('/', controller.createPage.bind(controller));

    router.post('/preview', controller.previewMarkdown.bind(controller));
    router.get('/settings', controller.getSettings.bind(controller));
    router.patch('/settings', controller.updateSettings.bind(controller));

    router.get('/:id', controller.getPage.bind(controller));
    router.patch('/:id', controller.updatePage.bind(controller));
    router.delete('/:id', controller.deletePage.bind(controller));

    return router;
}
