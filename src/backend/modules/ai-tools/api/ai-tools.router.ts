/**
 * @file ai-tools.router.ts
 *
 * Express router for the AI tool governance admin API, mounted at
 * `/api/admin/system/ai-tools`. Every endpoint is rate-limited and requires
 * admin authentication — the rate limiter runs first so it bounds the
 * brute-force cost against the auth gate itself.
 */

import { Router } from 'express';
import type { AiToolsController } from './ai-tools.controller.js';
import { requireAdmin } from '../../../api/middleware/admin-auth.js';
import { createAdminRateLimiter } from '../../../api/middleware/rate-limit.js';

/**
 * Build the AI tool admin router.
 *
 * @param controller - The controller whose handlers back each route.
 * @returns The configured router.
 */
export function createAiToolsAdminRouter(controller: AiToolsController): Router {
    const router = Router();

    router.use(createAdminRateLimiter('ai-tools-admin'));
    router.use(requireAdmin);

    router.get('/tools', controller.listTools);
    router.patch('/tools/:name', controller.setToolEnabled);

    router.get('/trifecta', controller.getTrifecta);
    router.get('/providers', controller.listProviders);

    router.get('/variables', controller.listVariables);
    router.post('/variables', controller.createVariable);
    router.patch('/variables/:name', controller.updateVariable);
    router.delete('/variables/:name', controller.deleteVariable);
    router.put('/variables/:name/classification', controller.classifyVariable);

    router.get('/system-prompts', controller.getSystemPrompts);
    router.put('/system-prompts/master', controller.setMasterSystemPrompt);
    router.post('/system-prompts', controller.saveSystemPrompt);
    router.delete('/system-prompts/:id', controller.deleteSystemPrompt);

    router.post('/query', controller.query);
    router.post('/query/:queryId/cancel', controller.cancelQuery);
    router.get('/query/history', controller.listQueryHistory);
    router.get('/query/models', controller.listQueryModels);
    router.get('/query/providers', controller.listQueryProviders);
    router.get('/query/conversations/:conversationId', controller.getConversationHistory);

    router.get('/query/prompts', controller.listPrompts);
    router.post('/query/prompts', controller.savePrompt);
    router.delete('/query/prompts/:id', controller.deletePrompt);

    router.get('/activity', controller.listActivity);
    router.get('/activity/:id', controller.getActivity);

    router.get('/approvals', controller.listApprovals);
    router.get('/approvals/count', controller.getApprovalsCount);
    router.post('/approvals/:id/approve', controller.approve);
    router.post('/approvals/:id/reject', controller.reject);

    router.get('/policy', controller.getPolicy);
    router.put('/policy/:name', controller.setPolicy);
    router.delete('/policy/:name', controller.clearPolicy);

    router.get('/curations', controller.listCurations);
    router.get('/curations/count', controller.getCurationsCount);
    router.get('/curations/history', controller.listCurationHistory);
    router.patch('/curations/:id', controller.editCuration);
    router.post('/curations/:id/approve', controller.approveCuration);
    router.post('/curations/:id/reject', controller.rejectCuration);

    return router;
}
