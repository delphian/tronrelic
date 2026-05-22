/**
 * @fileoverview Express router for the hook-introspection admin endpoint.
 *
 * Builds a single-route Express router and returns it to the bootstrap
 * caller. Admin authentication is applied at mount time by the caller —
 * the router itself is unauthenticated so the same factory can be used
 * by tests without dragging the auth middleware into the test path.
 *
 * @module backend/hooks/api/hooks.routes
 */

import { Router } from 'express';
import type { HooksController } from './hooks.controller.js';

/**
 * Build the admin router for the hook introspection surface.
 *
 * @param controller - Controller instance bound to the registry.
 * @returns Express router with a single GET endpoint.
 */
export function createHooksAdminRouter(controller: HooksController): Router {
    const router = Router();
    router.get('/', controller.getSnapshot);

    return router;
}
