import { Router } from 'express';
import type { UserController } from './user.controller.js';
import type { UserGroupController } from './user-group.controller.js';
import { createRateLimiter } from '../../../api/middleware/rate-limit.js';
import { userContextMiddleware } from '../../../api/middleware/user-context.js';

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

    // Bootstrap rate limiter — slightly tighter than the rest because this
    // endpoint mints persistent identity. Even with idempotent semantics, an
    // attacker hammering it would create churn in user counts.
    const bootstrapRateLimiter = createRateLimiter({
        windowSeconds: 60,
        maxRequests: 10,
        keyPrefix: 'user:bootstrap'
    });

    // Bootstrap is the only public user route that runs WITHOUT cookie
    // validation — the whole point is to mint the cookie when none exists.
    // Mounted before the `/:id` cookie-validation middleware so its specific
    // path wins.
    router.post('/bootstrap', bootstrapRateLimiter, controller.bootstrap.bind(controller));

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
     * Stage 1: register the wallet (no signature). Moves the user from
     * *anonymous* to *registered*. See `connectWallet` controller for details.
     */
    router.post('/:id/wallet/connect', walletRateLimiter, controller.connectWallet.bind(controller));

    /**
     * POST /api/user/:id/wallet/challenge
     * Mint a server-issued single-use nonce for a wallet operation. Required
     * before link/unlink/set-primary. Mounted before the bare `/wallet` route
     * so its specific path wins. See `issueWalletChallenge` controller.
     */
    router.post('/:id/wallet/challenge', walletRateLimiter, controller.issueWalletChallenge.bind(controller));

    /**
     * POST /api/user/:id/wallet
     * Stage 2: verify the wallet via signature against a fresh nonce. Moves
     * the user (or the specific wallet) into the *verified* state. See
     * `linkWallet` controller for details.
     */
    router.post('/:id/wallet', walletRateLimiter, controller.linkWallet.bind(controller));

    /**
     * DELETE /api/user/:id/wallet/:address
     * Unlink wallet from user (requires signature)
     */
    router.delete('/:id/wallet/:address', walletRateLimiter, controller.unlinkWallet.bind(controller));

    /**
     * PATCH /api/user/:id/wallet/:address/primary
     * Set wallet as primary. Requires signature over a fresh challenge —
     * cookie alone is insufficient because primary drives downstream
     * attribution and a captured cookie should not steer it.
     */
    router.patch('/:id/wallet/:address/primary', walletRateLimiter, controller.setPrimaryWallet.bind(controller));

    /**
     * POST /api/user/:id/wallet/:address/refresh-verification
     * Refresh `verifiedAt` on an already-verified wallet. Narrower
     * equivalent of the link flow — both update `verifiedAt`, but this
     * one only operates on already-verified wallets and never toggles
     * `verified`. Used by callers that specifically want to bump
     * freshness without going through link's full validation. Requires
     * a `refresh-verification` nonce and a TronLink signature; nonce
     * action-scoping prevents replay of signatures from other actions.
     */
    router.post('/:id/wallet/:address/refresh-verification', walletRateLimiter, controller.refreshWalletVerification.bind(controller));

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
     * Record user activity (legacy - prefer session/page)
     */
    router.post('/:id/activity', activityRateLimiter, controller.recordActivity.bind(controller));

    // ============================================================================
    // Session Tracking Routes (60 requests/minute)
    // ============================================================================

    /**
     * POST /api/user/:id/session/start
     * Start new session or return active session
     */
    router.post('/:id/session/start', activityRateLimiter, controller.startSession.bind(controller));

    /**
     * POST /api/user/:id/session/page
     * Record page visit in current session
     */
    router.post('/:id/session/page', activityRateLimiter, controller.recordPage.bind(controller));

    /**
     * POST /api/user/:id/session/heartbeat
     * Update session heartbeat for duration tracking
     */
    router.post('/:id/session/heartbeat', activityRateLimiter, controller.heartbeat.bind(controller));

    /**
     * POST /api/user/:id/session/end
     * End current session explicitly
     */
    router.post('/:id/session/end', activityRateLimiter, controller.endSession.bind(controller));

    // ============================================================================
    // Referral Routes (30 requests/minute)
    // ============================================================================

    /**
     * GET /api/user/:id/referral
     * Get referral code and stats
     */
    router.get('/:id/referral', userRateLimiter, controller.getReferralStats.bind(controller));

    // ============================================================================
    // Logout Route (30 requests/minute)
    // ============================================================================

    /**
     * POST /api/user/:id/logout
     * End the user's verified session (downgrade identityState to
     * Registered or Anonymous, clear identityVerifiedAt). The cookie
     * persists; re-establishing a session requires signing with a
     * historically-verified wallet via /wallet (link).
     */
    router.post('/:id/logout', userRateLimiter, controller.logout.bind(controller));

    return router;
}

/**
 * Create Express router for public profile endpoints.
 *
 * No authentication is required to read a public profile, but
 * `userContextMiddleware` populates `req.userId` from the visitor's
 * `tronrelic_uid` cookie when present so the controller can compute
 * `isOwner` server-side without echoing the owning UUID back over the wire.
 *
 * Routes are mounted at /api/profile.
 *
 * Rate limits (per IP):
 * - Profile lookups: 60 requests/minute
 *
 * @param controller - User controller instance
 * @returns Express router with public profile endpoints
 */
export function createProfileRouter(controller: UserController): Router {
    const router = Router();

    const profileRateLimiter = createRateLimiter({
        windowSeconds: 60,
        maxRequests: 60,
        keyPrefix: 'profile:lookup'
    });

    /**
     * GET /api/profile/:address
     * Get public profile by verified wallet address
     */
    router.get(
        '/:address',
        userContextMiddleware,
        profileRateLimiter,
        controller.getProfile.bind(controller)
    );

    return router;
}

/**
 * Create Express router for admin user endpoints.
 *
 * All routes require admin authentication (handled by parent router middleware).
 * Routes are mounted at /api/admin/users. The user-group controller is
 * injected so the per-user membership editor (`PUT /:id/groups`) can live
 * inside the user admin tree without coupling UserController to group
 * concerns.
 *
 * @param controller - User controller instance
 * @param groupController - User-group controller for membership mutation
 * @returns Express router with admin endpoints
 */
export function createAdminUserRouter(
    controller: UserController,
    groupController: UserGroupController
): Router {
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
     * GET /api/admin/users/analytics/daily-visitors
     * Get daily unique visitor counts for charting
     */
    router.get('/analytics/daily-visitors', controller.getDailyVisitors.bind(controller));

    /**
     * GET /api/admin/users/analytics/visitor-origins
     * Get visitor traffic origins from first-ever sessions
     */
    router.get('/analytics/visitor-origins', controller.getVisitorOrigins.bind(controller));

    /**
     * GET /api/admin/users/analytics/new-users
     * Get new users first seen within period, sorted by firstSeen descending
     */
    router.get('/analytics/new-users', controller.getNewUsers.bind(controller));

    // ============================================================================
    // Aggregate Analytics Routes
    // ============================================================================

    /**
     * GET /api/admin/users/analytics/traffic-sources
     * Get aggregate traffic source breakdown
     */
    router.get('/analytics/traffic-sources', controller.getTrafficSources.bind(controller));

    /**
     * GET /api/admin/users/analytics/traffic-source-details
     * Get detailed breakdown for a specific traffic source
     */
    router.get('/analytics/traffic-source-details', controller.getTrafficSourceDetails.bind(controller));

    /**
     * GET /api/admin/users/analytics/top-landing-pages
     * Get top landing pages by visitor count
     */
    router.get('/analytics/top-landing-pages', controller.getTopLandingPages.bind(controller));

    /**
     * GET /api/admin/users/analytics/geo-distribution
     * Get geographic distribution of visitors
     */
    router.get('/analytics/geo-distribution', controller.getGeoDistribution.bind(controller));

    /**
     * GET /api/admin/users/analytics/device-breakdown
     * Get device and screen size breakdown
     */
    router.get('/analytics/device-breakdown', controller.getDeviceBreakdown.bind(controller));

    /**
     * GET /api/admin/users/analytics/campaign-performance
     * Get UTM campaign performance with conversion rates
     */
    router.get('/analytics/campaign-performance', controller.getCampaignPerformance.bind(controller));

    /**
     * GET /api/admin/users/analytics/engagement
     * Get engagement metrics (avg duration, pages/session, bounce rate)
     */
    router.get('/analytics/engagement', controller.getEngagementMetrics.bind(controller));

    /**
     * GET /api/admin/users/analytics/conversion-funnel
     * Get conversion funnel (visitors → return → wallet → verified)
     */
    router.get('/analytics/conversion-funnel', controller.getConversionFunnel.bind(controller));

    /**
     * GET /api/admin/users/analytics/retention
     * Get new vs returning visitor breakdown over time
     */
    router.get('/analytics/retention', controller.getRetention.bind(controller));

    /**
     * GET /api/admin/users/analytics/referral-overview
     * Get aggregate referral program metrics
     */
    router.get('/analytics/referral-overview', controller.getReferralOverview.bind(controller));

    // ============================================================================
    // Google Search Console Routes
    // ============================================================================

    /**
     * GET /api/admin/users/analytics/gsc/status
     * Get GSC configuration status
     */
    router.get('/analytics/gsc/status', controller.getGscStatus.bind(controller));

    /**
     * POST /api/admin/users/analytics/gsc/credentials
     * Save GSC service account credentials
     */
    router.post('/analytics/gsc/credentials', controller.saveGscCredentials.bind(controller));

    /**
     * DELETE /api/admin/users/analytics/gsc/credentials
     * Remove stored GSC credentials
     */
    router.delete('/analytics/gsc/credentials', controller.removeGscCredentials.bind(controller));

    /**
     * POST /api/admin/users/analytics/gsc/refresh
     * Trigger on-demand GSC data fetch
     */
    router.post('/analytics/gsc/refresh', controller.refreshGscData.bind(controller));

    /**
     * GET /api/admin/users/:id
     * Get any user by UUID (admin bypass)
     */
    router.get('/:id', controller.getAnyUser.bind(controller));

    /**
     * PUT /api/admin/users/:id/groups
     * Replace the user's complete group membership. Body: { groups: string[] }.
     * Audit-logged at info level by the controller.
     */
    router.put('/:id/groups', groupController.setUserGroups.bind(groupController));

    return router;
}
