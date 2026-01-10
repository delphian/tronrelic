import { Router } from 'express';
import type { ThemeController } from './theme.controller.js';

/**
 * Create public theme routes.
 *
 * These endpoints are accessible without authentication and provide
 * read-only access to theme data for frontend rendering.
 *
 * @param controller - Theme controller instance
 * @returns Express router with public routes
 */
export function createPublicRouter(controller: ThemeController): Router {
    const router = Router();

    // GET /api/system/themes - List all themes
    router.get('/', controller.listThemes.bind(controller));

    // GET /api/system/themes/active - Get active themes for SSR
    router.get('/active', controller.getActiveThemes.bind(controller));

    // GET /api/system/themes/:id - Get single theme
    router.get('/:id', controller.getTheme.bind(controller));

    return router;
}

/**
 * Create admin theme routes.
 *
 * These endpoints require admin authentication and provide full CRUD
 * operations for theme management.
 *
 * Note: Authentication middleware (requireAdmin) is applied when
 * mounting this router in the module's run() phase.
 *
 * @param controller - Theme controller instance
 * @returns Express router with admin routes
 */
export function createAdminRouter(controller: ThemeController): Router {
    const router = Router();

    // POST /api/admin/system/themes - Create theme
    router.post('/', controller.createTheme.bind(controller));

    // PUT /api/admin/system/themes/:id - Update theme
    router.put('/:id', controller.updateTheme.bind(controller));

    // DELETE /api/admin/system/themes/:id - Delete theme
    router.delete('/:id', controller.deleteTheme.bind(controller));

    // PATCH /api/admin/system/themes/:id/toggle - Toggle active status
    router.patch('/:id/toggle', controller.toggleTheme.bind(controller));

    // POST /api/admin/system/themes/:id/validate - Validate CSS
    router.post('/:id/validate', controller.validateCSS.bind(controller));

    return router;
}
