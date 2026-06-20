/**
 * @fileoverview Router factory for the user-facing notification preferences
 * endpoints. Login-gated inside the controller (not admin) — any signed-in user
 * manages their own opt-outs.
 */

import { Router } from 'express';
import type { PreferencesController } from './preferences.controller.js';

/**
 * Build the `/api/notifications` router.
 *
 * @param controller - The preferences controller.
 * @returns An Express router exposing GET/PUT for the caller's preferences.
 */
export function createPreferencesRouter(controller: PreferencesController): Router {
    const router = Router();
    router.get('/preferences', controller.getPreferences);
    router.put('/preferences', controller.updatePreferences);
    return router;
}
