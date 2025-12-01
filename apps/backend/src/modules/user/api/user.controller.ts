import type { Request, Response, NextFunction } from 'express';
import type { ISystemLogService } from '@tronrelic/types';
import type { UserService, IUserStats, UserFilterType } from '../services/index.js';
import type { IUser, IUserPreferences } from '../database/index.js';
import { getClientIP } from '../services/index.js';

/**
 * Cookie name for user identity.
 */
const COOKIE_NAME = 'tronrelic_uid';

/**
 * Controller for user module REST API endpoints.
 *
 * Handles HTTP requests for user identity, wallet linking, preferences,
 * and activity tracking. Public endpoints require cookie validation;
 * admin endpoints require admin token.
 *
 * Routes are mounted at:
 * - /api/user (public routes with cookie validation)
 * - /api/admin/users (admin routes with token auth)
 */
export class UserController {
    /**
     * Create a user controller.
     *
     * @param userService - Service for user operations
     * @param logger - System log service for error tracking
     */
    constructor(
        private readonly userService: UserService,
        private readonly logger: ISystemLogService
    ) {}

    // ============================================================================
    // Middleware
    // ============================================================================

    /**
     * Cookie validation middleware.
     *
     * Ensures the request cookie matches the :id parameter. This prevents
     * UUID enumeration and ensures users can only access their own data.
     *
     * @param req - Express request
     * @param res - Express response
     * @param next - Express next function
     */
    validateCookie(req: Request, res: Response, next: NextFunction): void {
        const cookieId = req.cookies?.[COOKIE_NAME];
        const paramId = req.params.id;

        if (!cookieId) {
            res.status(401).json({
                error: 'Unauthorized',
                message: 'Missing identity cookie'
            });
            return;
        }

        if (cookieId !== paramId) {
            res.status(403).json({
                error: 'Forbidden',
                message: 'Cookie does not match requested user ID'
            });
            return;
        }

        next();
    }

    // ============================================================================
    // Public User Endpoints (require cookie validation)
    // ============================================================================

    /**
     * GET /api/user/:id
     *
     * Get user by UUID. Creates user if not exists.
     *
     * Requires: Cookie must match :id
     * Response: IUser
     */
    async getUser(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;

            const user = await this.userService.getOrCreate(id);

            res.json(user);
        } catch (error) {
            this.logger.error({ error, userId: req.params.id }, 'Failed to get user');
            res.status(400).json({
                error: 'Failed to get user',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * POST /api/user/:id/wallet/connect
     *
     * Connect a wallet to user identity (without verification).
     *
     * This is the first step in the two-step wallet flow. Stores the
     * wallet address as unverified. Use linkWallet to verify ownership.
     *
     * Requires: Cookie must match :id
     * Body: { address }
     * Response: IUser
     */
    async connectWallet(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const { address } = req.body;

            if (!address) {
                res.status(400).json({
                    error: 'Missing required field',
                    message: 'Request must include address'
                });
                return;
            }

            const user = await this.userService.connectWallet(id, address);

            this.logger.info({ userId: id, wallet: address }, 'Wallet connected via API');
            res.json(user);
        } catch (error) {
            this.logger.error({ error, userId: req.params.id }, 'Failed to connect wallet');
            res.status(400).json({
                error: 'Failed to connect wallet',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * POST /api/user/:id/wallet
     *
     * Link a wallet to user identity (with signature verification).
     *
     * Verifies wallet ownership via TronLink signature. If wallet was
     * previously connected (unverified), updates it to verified.
     *
     * Requires: Cookie must match :id, wallet signature verification
     * Body: { address, message, signature, timestamp }
     * Response: IUser
     */
    async linkWallet(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const { address, message, signature, timestamp } = req.body;

            if (!address || !message || !signature || !timestamp) {
                res.status(400).json({
                    error: 'Missing required fields',
                    message: 'Request must include address, message, signature, and timestamp'
                });
                return;
            }

            const user = await this.userService.linkWallet(id, {
                address,
                message,
                signature,
                timestamp: Number(timestamp)
            });

            this.logger.info({ userId: id, wallet: address }, 'Wallet linked via API');
            res.json(user);
        } catch (error) {
            this.logger.error({ error, userId: req.params.id }, 'Failed to link wallet');
            res.status(400).json({
                error: 'Failed to link wallet',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * DELETE /api/user/:id/wallet/:address
     *
     * Unlink a wallet from user identity.
     *
     * Requires: Cookie must match :id, wallet signature verification
     * Body: { message, signature }
     * Response: IUser
     */
    async unlinkWallet(req: Request, res: Response): Promise<void> {
        try {
            const { id, address } = req.params;
            const { message, signature } = req.body;

            if (!message || !signature) {
                res.status(400).json({
                    error: 'Missing required fields',
                    message: 'Request must include message and signature'
                });
                return;
            }

            const user = await this.userService.unlinkWallet(id, address, message, signature);

            this.logger.info({ userId: id, wallet: address }, 'Wallet unlinked via API');
            res.json(user);
        } catch (error) {
            this.logger.error({ error, userId: req.params.id }, 'Failed to unlink wallet');
            res.status(400).json({
                error: 'Failed to unlink wallet',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * PATCH /api/user/:id/wallet/:address/primary
     *
     * Set a wallet as primary.
     *
     * Requires: Cookie must match :id, wallet signature verification
     * Body: { message, signature }
     * Response: IUser
     */
    async setPrimaryWallet(req: Request, res: Response): Promise<void> {
        try {
            const { id, address } = req.params;
            const { message, signature } = req.body;

            if (!message || !signature) {
                res.status(400).json({
                    error: 'Missing required fields',
                    message: 'Request must include message and signature'
                });
                return;
            }

            const user = await this.userService.setPrimaryWallet(id, address, message, signature);

            this.logger.debug({ userId: id, wallet: address }, 'Primary wallet set via API');
            res.json(user);
        } catch (error) {
            this.logger.error({ error, userId: req.params.id }, 'Failed to set primary wallet');
            res.status(400).json({
                error: 'Failed to set primary wallet',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * PATCH /api/user/:id/preferences
     *
     * Update user preferences.
     *
     * Requires: Cookie must match :id
     * Body: Partial<IUserPreferences>
     * Response: IUser
     */
    async updatePreferences(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const preferences = req.body as Partial<IUserPreferences>;

            if (!preferences || typeof preferences !== 'object') {
                res.status(400).json({
                    error: 'Invalid request body',
                    message: 'Body must be a preferences object'
                });
                return;
            }

            const user = await this.userService.updatePreferences(id, preferences);

            res.json(user);
        } catch (error) {
            this.logger.error({ error, userId: req.params.id }, 'Failed to update preferences');
            res.status(400).json({
                error: 'Failed to update preferences',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * POST /api/user/:id/activity
     *
     * Record user activity (page view).
     *
     * Requires: Cookie must match :id
     * Response: { success: true }
     *
     * @deprecated Use POST /api/user/:id/session/page for session-aware tracking
     */
    async recordActivity(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;

            await this.userService.recordActivity(id);

            res.json({ success: true });
        } catch (error) {
            // Don't fail on activity recording errors
            this.logger.warn({ error, userId: req.params.id }, 'Failed to record activity');
            res.json({ success: true });
        }
    }

    // ============================================================================
    // Session Tracking Endpoints (require cookie validation)
    // ============================================================================

    /**
     * POST /api/user/:id/session/start
     *
     * Start a new session or return the active session.
     * Device, country, and referrer are derived from request headers.
     *
     * Requires: Cookie must match :id
     * Response: { session: IUserSession }
     */
    async startSession(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;

            // Extract request context (never stored raw)
            const clientIP = getClientIP(req);
            const userAgent = req.headers['user-agent'];
            const referrer = req.headers['referer'] || req.body.referrer;

            const session = await this.userService.startSession(
                id,
                clientIP,
                userAgent,
                referrer
            );

            res.json({ session });
        } catch (error) {
            this.logger.warn({ error, userId: req.params.id }, 'Failed to start session');
            res.status(400).json({
                error: 'Failed to start session',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * POST /api/user/:id/session/page
     *
     * Record a page visit in the current session.
     *
     * Requires: Cookie must match :id
     * Body: { path: string }
     * Response: { success: true }
     */
    async recordPage(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const { path } = req.body;

            if (!path || typeof path !== 'string') {
                res.status(400).json({
                    error: 'Invalid request',
                    message: 'Body must include path string'
                });
                return;
            }

            await this.userService.recordPage(id, path);

            res.json({ success: true });
        } catch (error) {
            // Non-critical - don't fail the request
            this.logger.warn({ error, userId: req.params.id }, 'Failed to record page');
            res.json({ success: true });
        }
    }

    /**
     * POST /api/user/:id/session/heartbeat
     *
     * Update session heartbeat to extend duration tracking.
     * Should be called periodically (e.g., every 30 seconds).
     *
     * Requires: Cookie must match :id
     * Response: { success: true }
     */
    async heartbeat(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;

            await this.userService.heartbeat(id);

            res.json({ success: true });
        } catch (error) {
            // Non-critical - don't fail the request
            this.logger.warn({ error, userId: req.params.id }, 'Failed to record heartbeat');
            res.json({ success: true });
        }
    }

    /**
     * POST /api/user/:id/session/end
     *
     * End the current session explicitly.
     * Called when user navigates away or closes the page.
     *
     * Requires: Cookie must match :id
     * Response: { success: true }
     */
    async endSession(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;

            await this.userService.endSession(id);

            res.json({ success: true });
        } catch (error) {
            // Non-critical - don't fail the request
            this.logger.warn({ error, userId: req.params.id }, 'Failed to end session');
            res.json({ success: true });
        }
    }

    // ============================================================================
    // Login State Endpoints (require cookie validation)
    // ============================================================================

    /**
     * POST /api/user/:id/login
     *
     * Log in a user (set isLoggedIn to true).
     *
     * This is a UI/feature gate - it controls what is surfaced to the user,
     * not their underlying identity. UUID tracking continues regardless.
     *
     * Requires: Cookie must match :id
     * Response: IUser
     */
    async login(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;

            const user = await this.userService.login(id);

            this.logger.info({ userId: id }, 'User logged in via API');
            res.json(user);
        } catch (error) {
            this.logger.error({ error, userId: req.params.id }, 'Failed to log in user');
            res.status(400).json({
                error: 'Failed to log in',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * POST /api/user/:id/logout
     *
     * Log out a user (set isLoggedIn to false).
     *
     * This is a UI/feature gate - wallets and all other data remain intact.
     * The user is still tracked by UUID under the hood.
     *
     * Requires: Cookie must match :id
     * Response: IUser
     */
    async logout(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;

            const user = await this.userService.logout(id);

            this.logger.info({ userId: id }, 'User logged out via API');
            res.json(user);
        } catch (error) {
            this.logger.error({ error, userId: req.params.id }, 'Failed to log out user');
            res.status(400).json({
                error: 'Failed to log out',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    // ============================================================================
    // Admin Endpoints (require admin token)
    // ============================================================================

    /**
     * GET /api/admin/users
     *
     * List all users with pagination and optional filtering.
     *
     * Query parameters:
     * - limit: Maximum results (default: 50)
     * - skip: Skip results for pagination (default: 0)
     * - search: Search by UUID or wallet address
     * - filter: Filter by predefined criteria (e.g., 'power-users', 'no-wallet')
     *
     * Filter and search work additively (AND logic). Applying a filter
     * narrows the user set, then search refines within filtered results.
     *
     * Response: { users: IUser[], total: number, filteredTotal: number, stats: IUserStats }
     */
    async listUsers(req: Request, res: Response): Promise<void> {
        try {
            const { limit, skip, search, filter } = req.query;

            const limitNum = limit ? parseInt(limit as string, 10) : 50;
            const skipNum = skip ? parseInt(skip as string, 10) : 0;
            const filterType = (filter as UserFilterType) || 'all';

            // Use filterUsers which handles both filter and search with AND logic
            const { users, filteredTotal } = await this.userService.filterUsers(
                filterType,
                limitNum,
                skipNum,
                search as string | undefined
            );

            const [total, stats] = await Promise.all([
                this.userService.countUsers(),
                this.userService.getStats()
            ]);

            res.json({ users, total, filteredTotal, stats });
        } catch (error) {
            this.logger.error({ error }, 'Failed to list users');
            res.status(500).json({
                error: 'Failed to list users',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * GET /api/admin/users/stats
     *
     * Get user statistics summary.
     *
     * Response: IUserStats
     */
    async getStats(req: Request, res: Response): Promise<void> {
        try {
            const stats = await this.userService.getStats();

            res.json(stats);
        } catch (error) {
            this.logger.error({ error }, 'Failed to get user stats');
            res.status(500).json({
                error: 'Failed to get user stats',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * GET /api/admin/users/:id
     *
     * Get any user by UUID (admin bypass).
     *
     * Response: IUser or 404
     */
    async getAnyUser(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;

            const user = await this.userService.getById(id);

            if (!user) {
                res.status(404).json({ error: 'User not found' });
                return;
            }

            res.json(user);
        } catch (error) {
            this.logger.error({ error, userId: req.params.id }, 'Failed to get user (admin)');
            res.status(500).json({
                error: 'Failed to get user',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
}
