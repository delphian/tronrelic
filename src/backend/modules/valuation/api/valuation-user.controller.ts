/**
 * @fileoverview User-facing HTTP layer for portfolio valuation.
 *
 * Two reads, one ownership rule. The aggregate (`/me/portfolio`) values the
 * caller's whole verified wallet set; the zoom (`/me/wallets/:address/portfolio`)
 * values one owned wallet. Both pass the *full* owned set so the service walks
 * every owned ledger and migrates an internal transfer's basis into the receiving
 * wallet's sub-book — so the zoom of a wallet funded by another owned wallet
 * carries real basis, not a phantom gain, and per-wallet figures sum to the
 * aggregate. The zoom gates on ownership and 404s an unowned address: knowing an
 * address is never authorization.
 */

import type { Request, Response } from 'express';
import type {
    IValuationService,
    IServiceRegistry,
    ISystemLogService,
    IWalletService,
    PortfolioScope
} from '@/types';

/**
 * Login-gated controller exposing a user's own portfolio at two scopes.
 */
export class ValuationUserController {
    /**
     * @param service - The valuation service that computes summaries.
     * @param serviceRegistry - Resolves the identity `'wallets'` service at request
     *   time, the only sanctioned path to the caller's verified addresses.
     * @param logger - Scoped logger for handler-level error reporting.
     */
    constructor(
        private readonly service: IValuationService,
        private readonly serviceRegistry: IServiceRegistry,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * GET /me/portfolio — the aggregate portfolio across every wallet the caller
     * verified. Resolves the owned set, then values all of it as one portfolio.
     * Degrades to a zeroed summary when identity is unavailable.
     *
     * @param req - Express request; `req.userId` set by `requireLogin`.
     * @param res - Express response; emits an `IPortfolioSummary`.
     */
    getMyPortfolio = async (req: Request, res: Response): Promise<void> => {
        try {
            const userId = req.userId;
            if (!userId) {
                res.status(401).json({ error: 'Authentication required' });
                return;
            }
            const owned = await this.ownedAddresses(userId);
            const summary = await this.service.getPortfolio({ addresses: owned, ownedAddresses: owned, scope: 'user' });
            res.json({ summary });
        } catch (error) {
            this.logger.error({ error }, 'Failed to compute aggregate portfolio');
            res.status(500).json({
                error: 'Failed to compute portfolio',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    };

    /**
     * GET /me/wallets/:address/portfolio — the same metric set scoped to one
     * owned wallet. 404s an address the caller has not verified. The full owned
     * set is still passed so an internal transfer's basis migrates to this wallet
     * rather than being booked as a phantom acquisition or gain.
     *
     * @param req - Express request; `req.userId` from `requireLogin`, `:address` the wallet.
     * @param res - Express response; emits an `IPortfolioSummary`.
     */
    getMyWalletPortfolio = async (req: Request, res: Response): Promise<void> => {
        try {
            const userId = req.userId;
            if (!userId) {
                res.status(401).json({ error: 'Authentication required' });
                return;
            }
            const address = String(req.params.address ?? '').trim();
            const owned = await this.ownedAddresses(userId);
            if (!address || !owned.includes(address)) {
                res.status(404).json({ error: 'Wallet not found' });
                return;
            }
            const scope: PortfolioScope = 'wallet';
            const summary = await this.service.getPortfolio({ addresses: [address], ownedAddresses: owned, scope });
            res.json({ summary });
        } catch (error) {
            this.logger.error({ error }, 'Failed to compute wallet portfolio');
            res.status(500).json({
                error: 'Failed to compute portfolio',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    };

    /**
     * Resolve the caller's verified wallet addresses through the identity
     * `'wallets'` service. Returns an empty list when identity is unavailable, so
     * a missing service degrades to "no wallets" rather than failing open.
     *
     * @param userId - The resolved Better Auth user id.
     * @returns The caller's verified base58 addresses.
     */
    private async ownedAddresses(userId: string): Promise<string[]> {
        const wallets = this.serviceRegistry.get<IWalletService>('wallets');
        if (!wallets) {
            return [];
        }
        const owned = await wallets.listWallets(userId);
        return owned.map((wallet) => wallet.address);
    }
}
