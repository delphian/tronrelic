/**
 * @fileoverview Route factory for the tools module.
 *
 * Creates an Express router with all tool endpoints. The router is mounted
 * by ToolsModule.run() using the IoC pattern. All handlers are wrapped with
 * asyncHandler to forward thrown errors to the global error handler, and
 * rate-limited to prevent abuse of unauthenticated endpoints.
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../../../api/middleware/async-handler.js';
import { createRateLimiter } from '../../../api/middleware/rate-limit.js';
import { userContextMiddleware } from '../../../api/middleware/user-context.js';
import type { ToolsController } from './tools.controller.js';

/**
 * Require the request user to have at least one cryptographically verified wallet.
 *
 * Depends on userContextMiddleware having already populated req.user.
 * Returns 401 when no user context exists and 403 when no verified wallet is found.
 */
function requireVerifiedWallet(req: Request, res: Response, next: NextFunction): void {
    if (!(req as any).user) {
        res.status(401).json({ error: 'Authentication required', message: 'A verified wallet is required to use this tool' });
        return;
    }

    const hasVerified = ((req as any).user.wallets ?? []).some((w: { verified?: boolean }) => w.verified);
    if (!hasVerified) {
        res.status(403).json({ error: 'Wallet verification required', message: 'You must verify a wallet via TronLink signature before using this tool' });
        return;
    }

    next();
}

/**
 * Create the tools router with all public endpoints.
 *
 * Applies per-IP rate limiting (30 requests per 60-second window) and wraps
 * all async handlers so rejected promises reach the global error middleware.
 *
 * @param controller - Initialized tools controller with all dependencies
 * @returns Express router ready for mounting
 */
export function createToolsRouter(controller: ToolsController): Router {
    const router = Router();

    const rateLimiter = createRateLimiter({
        windowSeconds: 60,
        maxRequests: 30,
        keyPrefix: 'tools'
    });

    const approvalRateLimiter = createRateLimiter({
        windowSeconds: 60,
        maxRequests: 10,
        keyPrefix: 'tools:approval'
    });

    router.post('/address/convert', rateLimiter, asyncHandler(controller.convertAddress));
    router.post('/energy/estimate', rateLimiter, asyncHandler(controller.estimateEnergy));
    router.post('/stake/from-trx', rateLimiter, asyncHandler(controller.estimateStakeFromTrx));
    router.post('/stake/from-energy', rateLimiter, asyncHandler(controller.estimateStakeFromEnergy));
    router.post('/signature/verify', rateLimiter, asyncHandler(controller.verifySignature));
    router.post('/approval/check', userContextMiddleware, requireVerifiedWallet, approvalRateLimiter, asyncHandler(controller.checkApprovals));
    router.post('/timestamp/convert', rateLimiter, asyncHandler(controller.convertTimestamp));

    return router;
}
