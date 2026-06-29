/**
 * @fileoverview Router factory for the central per-user settings endpoints.
 *
 * Mounted at `/api/user/settings`. Like the wallet router, these routes resolve
 * the caller from the Better Auth session inside the controller and carry no id
 * in the path — a user only ever reads or writes their own settings. The literal
 * `settings` segment sits alongside `/api/user/wallets`; no `/:id` catch-all
 * captures it.
 */

import { Router } from 'express';
import type { UserSettingsController } from './user-settings.controller.js';
import { createRateLimiter } from '../../../api/middleware/rate-limit.js';

/**
 * Create the Express router for the per-user settings endpoints.
 *
 * Per-IP rate-limited at a modest tier — settings changes are interactive and
 * infrequent, so a tight ceiling bounds abuse without hurting real use.
 * Authorization (401 for anonymous callers) is enforced inside the controller
 * off `req.authSession`.
 *
 * @param controller - User-settings controller instance.
 * @returns Express router to mount at `/api/user/settings`.
 */
export function createUserSettingsRouter(controller: UserSettingsController): Router {
    const router = Router();

    const settingsRateLimiter = createRateLimiter({
        windowSeconds: 60,
        maxRequests: 30,
        keyPrefix: 'user:settings'
    });

    /**
     * GET /api/user/settings
     * The caller's stored values plus the user-writable catalog.
     */
    router.get('/', settingsRateLimiter, controller.get.bind(controller));

    /**
     * PUT /api/user/settings
     * Write one registered, user-writable setting after validation.
     */
    router.put('/', settingsRateLimiter, controller.put.bind(controller));

    /**
     * DELETE /api/user/settings
     * Clear one setting, reverting it to the registered default.
     */
    router.delete('/', settingsRateLimiter, controller.remove.bind(controller));

    return router;
}
