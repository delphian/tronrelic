import { Router } from 'express';
import type { UserController } from './user.controller.js';

/**
 * Create Express router for public user endpoints.
 *
 * All routes require cookie validation - the tronrelic_uid cookie must match
 * the :id parameter. Routes are mounted at /api/user.
 *
 * @param controller - User controller instance
 * @returns Express router with public endpoints
 */
export function createUserRouter(controller: UserController): Router {
    const router = Router();

    // Apply cookie validation to all routes with :id parameter
    router.use('/:id', controller.validateCookie.bind(controller));
    router.use('/:id/*', controller.validateCookie.bind(controller));

    // ============================================================================
    // User Identity Routes
    // ============================================================================

    /**
     * GET /api/user/:id
     * Get or create user by UUID
     */
    router.get('/:id', controller.getUser.bind(controller));

    // ============================================================================
    // Wallet Routes
    // ============================================================================

    /**
     * POST /api/user/:id/wallet
     * Link wallet to user (requires signature)
     */
    router.post('/:id/wallet', controller.linkWallet.bind(controller));

    /**
     * DELETE /api/user/:id/wallet/:address
     * Unlink wallet from user (requires signature)
     */
    router.delete('/:id/wallet/:address', controller.unlinkWallet.bind(controller));

    /**
     * PATCH /api/user/:id/wallet/:address/primary
     * Set wallet as primary
     */
    router.patch('/:id/wallet/:address/primary', controller.setPrimaryWallet.bind(controller));

    // ============================================================================
    // Preferences Routes
    // ============================================================================

    /**
     * PATCH /api/user/:id/preferences
     * Update user preferences
     */
    router.patch('/:id/preferences', controller.updatePreferences.bind(controller));

    // ============================================================================
    // Activity Routes
    // ============================================================================

    /**
     * POST /api/user/:id/activity
     * Record user activity
     */
    router.post('/:id/activity', controller.recordActivity.bind(controller));

    return router;
}

/**
 * Create Express router for admin user endpoints.
 *
 * All routes require admin authentication (handled by parent router middleware).
 * Routes are mounted at /api/admin/users.
 *
 * @param controller - User controller instance
 * @returns Express router with admin endpoints
 */
export function createAdminUserRouter(controller: UserController): Router {
    const router = Router();

    /**
     * GET /api/admin/users
     * List all users (paginated)
     */
    router.get('/', controller.listUsers.bind(controller));

    /**
     * GET /api/admin/users/stats
     * Get user statistics
     * NOTE: Must come before /:id to avoid "stats" being treated as ID
     */
    router.get('/stats', controller.getStats.bind(controller));

    /**
     * GET /api/admin/users/:id
     * Get any user by UUID (admin bypass)
     */
    router.get('/:id', controller.getAnyUser.bind(controller));

    return router;
}
