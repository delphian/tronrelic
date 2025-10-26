import { Router } from 'express';
import type { PagesController } from './pages.controller.js';

/**
 * Create Express router for pages module endpoints.
 *
 * All routes require admin authentication (handled by parent router middleware).
 * Routes are mounted at /api/admin/pages.
 *
 * @param controller - Pages controller instance
 * @returns Express router with all endpoints registered
 */
export function createPagesRouter(controller: PagesController): Router {
    const router = Router();

    // ============================================================================
    // Page Routes
    // ============================================================================

    /**
     * GET /api/admin/pages
     * List pages with optional filtering
     */
    router.get('/', controller.listPages.bind(controller));

    // ============================================================================
    // File Routes
    // ============================================================================
    // NOTE: These routes must come BEFORE /:id to avoid "files" being treated as an ID

    /**
     * GET /api/admin/pages/files
     * List uploaded files
     */
    router.get('/files', controller.listFiles.bind(controller));

    /**
     * POST /api/admin/pages/files
     * Upload file
     */
    router.post(
        '/files',
        controller.getUploadMiddleware(),
        controller.uploadFile.bind(controller)
    );

    /**
     * DELETE /api/admin/pages/files/:id
     * Delete file
     */
    router.delete('/files/:id', controller.deleteFile.bind(controller));

    // ============================================================================
    // Settings Routes
    // ============================================================================
    // NOTE: These routes must come BEFORE /:id to avoid "settings" being treated as an ID

    /**
     * GET /api/admin/pages/settings
     * Get configuration settings
     */
    router.get('/settings', controller.getSettings.bind(controller));

    /**
     * PATCH /api/admin/pages/settings
     * Update configuration settings
     */
    router.patch('/settings', controller.updateSettings.bind(controller));

    // ============================================================================
    // Page-Specific Routes (with :id parameter)
    // ============================================================================
    // NOTE: These routes must come LAST to avoid capturing static routes like /files or /settings

    /**
     * GET /api/admin/pages/:id
     * Get single page by ID
     */
    router.get('/:id', controller.getPage.bind(controller));

    /**
     * POST /api/admin/pages
     * Create new page
     */
    router.post('/', controller.createPage.bind(controller));

    /**
     * PATCH /api/admin/pages/:id
     * Update existing page
     */
    router.patch('/:id', controller.updatePage.bind(controller));

    /**
     * DELETE /api/admin/pages/:id
     * Delete page
     */
    router.delete('/:id', controller.deletePage.bind(controller));

    return router;
}
