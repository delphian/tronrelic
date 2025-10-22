import { Router } from 'express';
import { MenuController } from '../../modules/menu/menu.controller.js';
import { requireAdmin } from '../middleware/admin-auth.js';

/**
 * Create the menu router with admin-protected endpoints.
 *
 * All menu endpoints require admin authentication via ADMIN_API_TOKEN. The
 * requireAdmin middleware validates the token before allowing access to any
 * menu operations.
 *
 * Routes:
 * - GET    /api/menu              - Get complete menu tree (optionally for specific namespace via ?namespace=foo)
 * - GET    /api/menu/namespaces   - Get all available menu namespaces
 * - POST   /api/menu              - Create new menu node
 * - PATCH  /api/menu/:id          - Update existing menu node
 * - DELETE /api/menu/:id          - Delete menu node
 *
 * Authentication:
 * - x-admin-token header (recommended)
 * - Authorization: Bearer {token} header
 *
 * @returns Express router with menu endpoints
 */
export function menuRouter() {
    const router = Router();
    const controller = new MenuController();

    // Apply admin authentication to all menu routes
    router.use(requireAdmin);

    /**
     * Get all available menu namespaces.
     *
     * Returns array of namespace strings currently in use.
     *
     * Example:
     * ```bash
     * curl -H "X-Admin-Token: $ADMIN_API_TOKEN" \
     *   http://localhost:4000/api/menu/namespaces
     * ```
     */
    router.get('/namespaces', controller.getNamespaces);

    /**
     * Get complete menu tree structure.
     *
     * Returns hierarchical representation with roots, flat list, and timestamp.
     * Optionally filter by namespace via query parameter.
     *
     * Examples:
     * ```bash
     * # Get main navigation (default)
     * curl -H "X-Admin-Token: $ADMIN_API_TOKEN" \
     *   http://localhost:4000/api/menu
     *
     * # Get footer menu
     * curl -H "X-Admin-Token: $ADMIN_API_TOKEN" \
     *   http://localhost:4000/api/menu?namespace=footer
     * ```
     */
    router.get('/', controller.getTree);

    /**
     * Create a new menu node.
     *
     * Request body should contain node properties (label required, others optional).
     *
     * Example:
     * ```bash
     * curl -X POST \
     *   -H "X-Admin-Token: $ADMIN_API_TOKEN" \
     *   -H "Content-Type: application/json" \
     *   -d '{"label":"Dashboard","url":"/dashboard","order":10}' \
     *   http://localhost:4000/api/menu
     * ```
     */
    router.post('/', controller.create);

    /**
     * Update an existing menu node.
     *
     * Request body should contain partial node properties to update.
     *
     * Example:
     * ```bash
     * curl -X PATCH \
     *   -H "X-Admin-Token: $ADMIN_API_TOKEN" \
     *   -H "Content-Type: application/json" \
     *   -d '{"label":"New Label","order":5}' \
     *   http://localhost:4000/api/menu/507f1f77bcf86cd799439011
     * ```
     */
    router.patch('/:id', controller.update);

    /**
     * Delete a menu node.
     *
     * WARNING: Does not cascade delete children. Implement cascade logic via
     * event subscribers if needed.
     *
     * Example:
     * ```bash
     * curl -X DELETE \
     *   -H "X-Admin-Token: $ADMIN_API_TOKEN" \
     *   http://localhost:4000/api/menu/507f1f77bcf86cd799439011
     * ```
     */
    router.delete('/:id', controller.delete);

    return router;
}
