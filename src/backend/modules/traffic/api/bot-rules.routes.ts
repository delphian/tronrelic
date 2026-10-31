/**
 * @fileoverview Router factory for the bot rules admin endpoints.
 *
 * Admin gating is applied by the traffic module where it mounts this router
 * (`requireAdmin`), matching the other traffic admin routers, so no per-route
 * auth middleware is declared here.
 */

import { Router } from 'express';
import type { BotRulesController } from './bot-rules.controller.js';

/**
 * Build the router for bot rule management, so the module can mount it under
 * its own admin prefix. The fixed paths are declared before `/:id` so they are
 * never read as a rule id.
 *
 * @param controller - Controller whose handlers are bound to the routes.
 * @returns Router exposing `GET /`, `POST /`, `POST /preview`, `GET /suggestions`,
 *   `PUT /:id`, and `DELETE /:id` (mounted at `/api/admin/traffic/bot-rules`).
 */
export function createAdminBotRulesRouter(controller: BotRulesController): Router {
    const router = Router();

    router.get('/', controller.list.bind(controller));
    router.post('/', controller.create.bind(controller));
    router.post('/preview', controller.preview.bind(controller));
    router.get('/suggestions', controller.suggestions.bind(controller));
    router.put('/:id', controller.update.bind(controller));
    router.delete('/:id', controller.remove.bind(controller));

    return router;
}
