/**
 * @fileoverview Router factory for the automated-network list admin endpoints.
 *
 * Admin gating is applied by the traffic module where it mounts this router
 * (`requireAdmin`), matching the other traffic admin routers, so no per-route
 * auth middleware is declared here.
 */

import { Router } from 'express';
import type { BotNetworksController } from './bot-networks.controller.js';

/**
 * Build the router that lists, adds, and removes automated networks, so the
 * module can mount it under its own admin prefix.
 *
 * @param controller - Controller whose handlers are bound to the routes.
 * @returns Router exposing `GET /`, `POST /`, and `DELETE /:asn`
 *   (mounted at `/api/admin/traffic/bot-networks`).
 */
export function createAdminBotNetworksRouter(controller: BotNetworksController): Router {
    const router = Router();

    router.get('/', controller.list.bind(controller));
    router.post('/', controller.add.bind(controller));
    router.delete('/:asn', controller.remove.bind(controller));

    return router;
}
