/**
 * @fileoverview Router factory for the Better Auth-keyed wallet endpoints.
 *
 * Mounted at `/api/user/wallets` (Phase 4). These routes resolve the
 * caller from the Better Auth session via {@link WalletController}, not
 * from a cookie-validated `:id` path param, so they carry no user id in
 * the URL. The mount point must be registered *before* the legacy
 * `/api/user` public router so the literal `wallets` segment is not
 * captured by that router's `/:id` cookie-validation middleware.
 */

import { Router } from 'express';
import type { WalletController } from './wallet.controller.js';
import { createRateLimiter } from '../../../api/middleware/rate-limit.js';

/**
 * Create the Express router for Better Auth-keyed wallet endpoints.
 *
 * All routes are per-IP rate-limited at the wallet-mutation tier (10
 * req/min) — wallet operations are infrequent and signature-gated, so a
 * tight ceiling is appropriate. Authorization (401 for anonymous
 * callers) is enforced inside the controller off `req.authSession`.
 *
 * @param controller - Wallet controller instance.
 * @returns Express router to mount at `/api/user/wallets`.
 */
export function createWalletRouter(controller: WalletController): Router {
    const router = Router();

    const walletRateLimiter = createRateLimiter({
        windowSeconds: 60,
        maxRequests: 10,
        keyPrefix: 'user:wallets'
    });

    /**
     * GET /api/user/wallets
     * List the signed-in account's linked wallets.
     */
    router.get('/', walletRateLimiter, controller.list.bind(controller));

    /**
     * POST /api/user/wallets/challenge
     * Mint a single-use challenge for a wallet operation. Mounted before
     * the bare `/` POST so its specific path wins.
     */
    router.post('/challenge', walletRateLimiter, controller.issueChallenge.bind(controller));

    /**
     * POST /api/user/wallets
     * Link a wallet after proving ownership via signature.
     */
    router.post('/', walletRateLimiter, controller.link.bind(controller));

    /**
     * DELETE /api/user/wallets/:address
     * Unlink a wallet (requires a fresh unlink challenge + signature).
     */
    router.delete('/:address', walletRateLimiter, controller.unlink.bind(controller));

    /**
     * PATCH /api/user/wallets/:address/primary
     * Set an already-linked wallet as primary (step-up: challenge + signature).
     */
    router.patch('/:address/primary', walletRateLimiter, controller.setPrimary.bind(controller));

    return router;
}
