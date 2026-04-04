/**
 * @fileoverview Route factory for the tools module.
 *
 * Creates an Express router with all tool endpoints. The router is mounted
 * by ToolsModule.run() using the IoC pattern. All handlers are wrapped with
 * asyncHandler to forward thrown errors to the global error handler, and
 * rate-limited to prevent abuse of unauthenticated endpoints.
 */

import { Router } from 'express';
import { asyncHandler } from '../../../api/middleware/async-handler.js';
import { createRateLimiter } from '../../../api/middleware/rate-limit.js';
import type { ToolsController } from './tools.controller.js';

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

    router.post('/address/convert', rateLimiter, asyncHandler(controller.convertAddress));
    router.post('/energy/estimate', rateLimiter, asyncHandler(controller.estimateEnergy));
    router.post('/stake/from-trx', rateLimiter, asyncHandler(controller.estimateStakeFromTrx));
    router.post('/stake/from-energy', rateLimiter, asyncHandler(controller.estimateStakeFromEnergy));
    router.post('/signature/verify', rateLimiter, asyncHandler(controller.verifySignature));

    return router;
}
