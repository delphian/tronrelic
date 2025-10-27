import { Router } from 'express';
import type { PagesController } from './pages.controller.js';

/**
 * Create Express router for public pages module endpoints.
 *
 * These routes do not require authentication and are accessible to all users.
 * Routes are mounted at /api/pages.
 *
 * @param controller - Pages controller instance
 * @returns Express router with public endpoints registered
 */
export function createPublicPagesRouter(controller: PagesController): Router {
    const router = Router();

    /**
     * GET /api/pages/:slug/render
     * Get rendered HTML for a published page
     *
     * Note: This must come before /:slug to avoid route conflicts
     */
    router.get('/:slug/render', controller.renderPublicPage.bind(controller));

    /**
     * GET /api/pages/:slug
     * Get published page metadata by slug
     */
    router.get('/:slug', controller.getPublicPage.bind(controller));

    return router;
}