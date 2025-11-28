import { Router } from 'express';
import type { UserController } from './user.controller.js';
import { createRateLimiter } from '../../../api/middleware/rate-limit.js';

/**
 * Create Express router for public user endpoints.
 *
 * All routes require cookie validation - the tronrelic_uid cookie must match
 * the :id parameter. Routes are mounted at /api/user.
 *
 * Rate limits (per IP):
 * - User identity/preferences: 30 requests/minute
 * - Activity recording: 60 requests/minute
 * - Wallet mutations: 10 requests/minute
 *
 * @param controller - User controller instance
 * @returns Express router with public endpoints
 */
export function createUserRouter(controller: UserController): Router {
    const router = Router();

    // Rate limiters for different endpoint categories
    const userRateLimiter = createRateLimiter({
        windowSeconds: 60,
        maxRequests: 30,
        keyPrefix: 'user:identity'
    });

    const activityRateLimiter = createRateLimiter({
        windowSeconds: 60,
        maxRequests: 60,
        keyPrefix: 'user:activity'
    });

    const walletRateLimiter = createRateLimiter({
        windowSeconds: 60,
        maxRequests: 10,
        keyPrefix: 'user:wallet'
    });

    // Apply cookie validation to all routes with :id parameter
    router.use('/:id', controller.validateCookie.bind(controller));
    router.use('/:id/*', controller.validateCookie.bind(controller));

    // ============================================================================
    // User Identity Routes (30 requests/minute)
    // ============================================================================

    /**
     * GET /api/user/:id
     * Get or create user by UUID
     */
    router.get('/:id', userRateLimiter, controller.getUser.bind(controller));

    // ============================================================================
    // Wallet Routes (10 requests/minute)
    // ============================================================================

    /**
     * POST /api/user/:id/wallet/connect
     * Connect wallet to user without verification (step 1 of 2-step flow)
     */
    router.post('/:id/wallet/connect', walletRateLimiter, controller.connectWallet.bind(controller));

    /**
     * POST /api/user/:id/wallet
     * Link wallet to user with signature verification (step 2 of 2-step flow)
     */
    router.post('/:id/wallet', walletRateLimiter, controller.linkWallet.bind(controller));

    /**
     * DELETE /api/user/:id/wallet/:address
     * Unlink wallet from user (requires signature)
     */
    router.delete('/:id/wallet/:address', walletRateLimiter, controller.unlinkWallet.bind(controller));

    /**
     * PATCH /api/user/:id/wallet/:address/primary
     * Set wallet as primary (requires signature)
     */
    router.patch('/:id/wallet/:address/primary', walletRateLimiter, controller.setPrimaryWallet.bind(controller));

    // ============================================================================
    // Preferences Routes (30 requests/minute)
    // ============================================================================

    /**
     * PATCH /api/user/:id/preferences
     * Update user preferences
     */
    router.patch('/:id/preferences', userRateLimiter, controller.updatePreferences.bind(controller));

    // ============================================================================
    // Activity Routes (60 requests/minute)
    // ============================================================================

    /**
     * POST /api/user/:id/activity
     * Record user activity
     */
    router.post('/:id/activity', activityRateLimiter, controller.recordActivity.bind(controller));

    // ============================================================================
    // Login State Routes (30 requests/minute)
    // ============================================================================

    /**
     * POST /api/user/:id/login
     * Log in user (set isLoggedIn to true)
     */
    router.post('/:id/login', userRateLimiter, controller.login.bind(controller));

    /**
     * POST /api/user/:id/logout
     * Log out user (set isLoggedIn to false)
     */
    router.post('/:id/logout', userRateLimiter, controller.logout.bind(controller));

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
