/**
 * @fileoverview User-facing HTTP layer for account-history download progress.
 *
 * The admin API exposes the whole tracked set; a signed-in user must see only
 * the backfill status of the wallets they personally verified. This controller
 * enforces that ownership boundary: it resolves the caller's verified wallets
 * through the identity module's published `'wallets'` service and returns
 * progress for only those addresses. Knowing an address is never authorization —
 * the response is always the intersection of "addresses the caller owns" and
 * "addresses currently tracked", so one user can never read another's status.
 */

import type { Request, Response } from 'express';
import type {
    IAccountHistoryService,
    IServiceRegistry,
    ISystemLogService,
    IWalletService
} from '@/types';

/**
 * Login-gated controller exposing a user's own wallet backfill progress.
 */
export class AccountHistoryUserController {
    /**
     * @param service - The central account-history service (progress reads).
     * @param serviceRegistry - Used to resolve the identity `'wallets'` service
     *   at request time, the only sanctioned path to the caller's verified
     *   addresses (identity owns that collection).
     * @param logger - Scoped logger for handler-level error reporting.
     */
    constructor(
        private readonly service: IAccountHistoryService,
        private readonly serviceRegistry: IServiceRegistry,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * GET /me/progress — download progress for the caller's own verified wallets.
     *
     * `requireLogin` has already populated `req.userId`. The handler resolves the
     * caller's verified addresses through `'wallets'`, then asks the service for
     * progress on only those — addresses the caller does not own are never
     * queried. Degrades to an empty list when identity is unavailable so the
     * profile page still renders.
     *
     * @param req - Express request; `req.userId` is the resolved Better Auth user id.
     * @param res - Express response; emits `{ progress }`.
     */
    getMyProgress = async (req: Request, res: Response): Promise<void> => {
        try {
            const userId = req.userId;
            if (!userId) {
                res.status(401).json({ error: 'Authentication required' });
                return;
            }

            const wallets = this.serviceRegistry.get<IWalletService>('wallets');
            if (!wallets) {
                res.json({ progress: [] });
                return;
            }

            const owned = await wallets.listWallets(userId);
            const progress = await this.service.getProgressFor(owned.map((wallet) => wallet.address));
            res.json({ progress });
        } catch (error) {
            this.logger.error({ error }, 'Failed to read wallet history progress');
            res.status(500).json({
                error: 'Failed to read history progress',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    };
}
