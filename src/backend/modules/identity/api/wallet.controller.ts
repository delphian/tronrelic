/**
 * @fileoverview HTTP interface for the Better Auth-keyed wallet store.
 *
 * These routes resolve the caller from the Better Auth session
 * (`req.authSession`, populated by the `attachAuthSession` middleware) and
 * carry no id in the path. Anonymous callers get 401; the account is never
 * named on the wire because it is implied by the session.
 *
 * The controller is a thin HTTP adapter: it resolves the session user
 * id, validates the request body, delegates to {@link WalletService},
 * and maps service errors to 4xx. All wallet business logic — challenge
 * verification, signature recovery, primary recomputation — lives in
 * the service.
 */

import type { Request, Response } from 'express';
import type { ISystemLogService } from '@/types';
import type { WalletService, WalletAction } from '../services/wallet.service.js';

/**
 * Wallet operations a challenge may be minted for.
 *
 * Mirrors {@link WalletAction}; declared as a runtime set so the
 * challenge endpoint can reject unknown actions with a 400 instead of
 * forwarding them to the service.
 */
const CHALLENGE_ACTIONS: ReadonlySet<WalletAction> = new Set<WalletAction>([
    'link',
    'unlink',
    'set-primary'
]);

/**
 * Controller for `/api/user/wallets/*`.
 *
 * Constructed in `IdentityModule.init()` with the {@link WalletService}
 * singleton and the module logger.
 */
export class WalletController {
    /**
     * @param walletService - Wallet store service.
     * @param logger - Module logger; a `component: 'wallet-controller'` child is derived.
     */
    constructor(
        private readonly walletService: WalletService,
        private readonly logger: ISystemLogService
    ) {
        this.logger = logger.child({ component: 'wallet-controller' });
    }

    /**
     * GET /api/user/wallets — list the signed-in account's wallets.
     */
    async list(req: Request, res: Response): Promise<void> {
        const userId = this.requireUserId(req, res);
        if (!userId) {
            return;
        }
        try {
            const wallets = await this.walletService.listWallets(userId);
            res.json({ wallets });
        } catch (error) {
            this.logger.error({ error, userId }, 'Failed to list wallets');
            res.status(500).json({ error: 'Failed to list wallets' });
        }
    }

    /**
     * POST /api/user/wallets/challenge — mint a single-use challenge.
     *
     * Body: { action: 'link' | 'unlink' | 'set-primary', address }
     */
    async issueChallenge(req: Request, res: Response): Promise<void> {
        const userId = this.requireUserId(req, res);
        if (!userId) {
            return;
        }
        try {
            const { action, address } = req.body ?? {};
            if (!action || !CHALLENGE_ACTIONS.has(action)) {
                res.status(400).json({
                    error: 'Invalid action',
                    message: "action must be one of 'link', 'unlink', 'set-primary'"
                });
                return;
            }
            if (!address) {
                res.status(400).json({ error: 'Missing required field', message: 'address is required' });
                return;
            }
            const challenge = await this.walletService.issueChallenge(userId, action, address);
            res.json(challenge);
        } catch (error) {
            this.logger.error({ error, userId }, 'Failed to issue wallet challenge');
            res.status(400).json({
                error: 'Failed to issue wallet challenge',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * POST /api/user/wallets — link a wallet after proving ownership.
     *
     * Body: { address, message, signature, nonce }
     */
    async link(req: Request, res: Response): Promise<void> {
        const userId = this.requireUserId(req, res);
        if (!userId) {
            return;
        }
        try {
            const input = this.parseMutationBody(req, res);
            if (!input) {
                return;
            }
            const wallets = await this.walletService.linkWallet(userId, input);
            res.json({ wallets });
        } catch (error) {
            this.logger.error({ error, userId }, 'Failed to link wallet');
            res.status(400).json({
                error: 'Failed to link wallet',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * DELETE /api/user/wallets/:address — unlink a wallet.
     *
     * Body: { message, signature, nonce } — the address comes from the path.
     */
    async unlink(req: Request, res: Response): Promise<void> {
        const userId = this.requireUserId(req, res);
        if (!userId) {
            return;
        }
        try {
            const { message, signature, nonce } = req.body ?? {};
            if (!message || !signature || !nonce) {
                res.status(400).json({
                    error: 'Missing required fields',
                    message: 'Request must include message, signature, and nonce'
                });
                return;
            }
            const wallets = await this.walletService.unlinkWallet(userId, {
                address: req.params.address,
                message,
                signature,
                nonce
            });
            res.json({ wallets });
        } catch (error) {
            this.logger.error({ error, userId }, 'Failed to unlink wallet');
            res.status(400).json({
                error: 'Failed to unlink wallet',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * PATCH /api/user/wallets/:address/primary — set the account's primary wallet.
     *
     * Body: { message, signature, nonce } — the address comes from the path.
     */
    async setPrimary(req: Request, res: Response): Promise<void> {
        const userId = this.requireUserId(req, res);
        if (!userId) {
            return;
        }
        try {
            const { message, signature, nonce } = req.body ?? {};
            if (!message || !signature || !nonce) {
                res.status(400).json({
                    error: 'Missing required fields',
                    message: 'Request must include message, signature, and nonce'
                });
                return;
            }
            const wallets = await this.walletService.setPrimaryWallet(userId, {
                address: req.params.address,
                message,
                signature,
                nonce
            });
            res.json({ wallets });
        } catch (error) {
            this.logger.error({ error, userId }, 'Failed to set primary wallet');
            res.status(400).json({
                error: 'Failed to set primary wallet',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Resolve the Better Auth user id from the request session.
     *
     * Sends 401 and returns `null` when no session is present, so each
     * handler can guard with `if (!userId) return;`. Reads the
     * middleware-populated `req.authSession`; never touches the facade or
     * cookies directly.
     *
     * @param req - Express request.
     * @param res - Express response (used to send 401 on miss).
     * @returns The signed-in user id, or `null` when anonymous.
     */
    private requireUserId(req: Request, res: Response): string | null {
        const userId = req.authSession?.user?.id ?? null;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized', message: 'Sign in required' });
            return null;
        }
        return userId;
    }

    /**
     * Validate the shared link/unlink/set-primary mutation body.
     *
     * Sends 400 and returns `null` when any required field is missing.
     *
     * @param req - Express request whose body carries the signed mutation.
     * @param res - Express response (used to send 400 on miss).
     * @returns The validated mutation input, or `null` when invalid.
     */
    private parseMutationBody(
        req: Request,
        res: Response
    ): { address: string; message: string; signature: string; nonce: string } | null {
        const { address, message, signature, nonce } = req.body ?? {};
        if (!address || !message || !signature || !nonce) {
            res.status(400).json({
                error: 'Missing required fields',
                message: 'Request must include address, message, signature, and nonce'
            });
            return null;
        }
        return { address, message, signature, nonce };
    }
}
