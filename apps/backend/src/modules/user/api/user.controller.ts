import type { Request, Response, NextFunction } from 'express';
import type { ISystemLogService } from '@tronrelic/types';
import type { UserService, IUserStats } from '../services/index.js';
import type { IUser, IUserPreferences } from '../database/index.js';

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
     * POST /api/user/:id/wallet
     *
     * Link a wallet to user identity.
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
     * Requires: Cookie must match :id
     * Response: IUser
     */
    async setPrimaryWallet(req: Request, res: Response): Promise<void> {
        try {
            const { id, address } = req.params;

            const user = await this.userService.setPrimaryWallet(id, address);

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
    // Admin Endpoints (require admin token)
    // ============================================================================

    /**
     * GET /api/admin/users
     *
     * List all users with pagination.
     *
     * Query parameters:
     * - limit: Maximum results (default: 50)
     * - skip: Skip results for pagination (default: 0)
     * - search: Search by UUID or wallet address
     *
     * Response: { users: IUser[], total: number, stats: IUserStats }
     */
    async listUsers(req: Request, res: Response): Promise<void> {
        try {
            const { limit, skip, search } = req.query;

            const limitNum = limit ? parseInt(limit as string, 10) : 50;
            const skipNum = skip ? parseInt(skip as string, 10) : 0;

            let users: IUser[];
            if (search) {
                users = await this.userService.searchUsers(search as string, limitNum);
            } else {
                users = await this.userService.listUsers(limitNum, skipNum);
            }

            const [total, stats] = await Promise.all([
                this.userService.countUsers(),
                this.userService.getStats()
            ]);

            res.json({ users, total, stats });
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
