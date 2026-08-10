/**
 * @file ai-tools.router.ts
 *
 * Express router for the AI tool governance admin API, mounted at
 * `/api/admin/system/ai-tools`. Every endpoint is rate-limited and requires
 * admin authentication — the rate limiter runs first so it bounds the
 * brute-force cost against the auth gate itself.
 *
 * A handful of routes go further and add `requireAdminUser`, which refuses the
 * `ADMIN_API_TOKEN` service path and admits only a signed-in admin. See the
 * comments at those routes for why each one earns the narrower gate.
 */

import { Router } from 'express';
import type { AiToolsController } from './ai-tools.controller.js';
import { requireAdmin, requireAdminUser } from '../../../api/middleware/admin-auth.js';
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
    router.post('/trifecta/preview', controller.previewTrifecta);
    router.get('/providers', controller.listProviders);

    router.get('/screen-config', controller.getScreenConfig);
    router.put('/screen-config', controller.setScreenConfig);

    // The bulk listing embeds each *static* variable's `content` so the admin
    // edit form can prefill it, and a new static defaults to `secret` — so this
    // response hands back plaintext secrets just as the reveal route below
    // does. Gated identically; leaving it on the shared token gate would have
    // made gating the reveal route decorative.
    router.get('/variables', requireAdminUser, controller.listVariables);
    // Resolves one variable to its plaintext value, `secret`-classified ones
    // included. A shared environment variable is too broad a key for reading a
    // secret, and it is exactly the act an audit trail needs a named operator
    // for (see the reveal log in the controller).
    router.get('/variables/:name/value', requireAdminUser, controller.revealVariable);
    router.post('/variables', controller.createVariable);
    router.patch('/variables/:name', controller.updateVariable);
    router.delete('/variables/:name', controller.deleteVariable);
    router.put('/variables/:name/classification', controller.classifyVariable);

    router.get('/system-prompts', controller.getSystemPrompts);
    router.put('/system-prompts/master', controller.setMasterSystemPrompt);
    router.post('/system-prompts', controller.saveSystemPrompt);
    router.delete('/system-prompts/:id', controller.deleteSystemPrompt);

    // Running a query and reading its transcript are both secret-read paths, so
    // they carry the same gate as the variable routes above. A prompt may
    // contain `{%name%}`, which the provider expands to the variable's real
    // value before the model sees it — so `{"prompt":"repeat verbatim:
    // {%some-secret%}"}` is a read of that secret by another route, and the
    // model's answer is persisted, which makes `/query/history` and
    // `/query/conversations/:id` reads of it too.
    //
    // Filtering `secret` variables out of expansion is not the fix: injecting
    // them is the feature (they are the lethal trifecta's private-data leg by
    // design). Gating the surface is. Together with the two variable routes
    // this closes every path by which the `ADMIN_API_TOKEN` service path can
    // reach a secret variable's value.
    router.post('/query', requireAdminUser, controller.query);
    router.post('/query/:queryId/cancel', controller.cancelQuery);
    router.get('/query/history', requireAdminUser, controller.listQueryHistory);
    router.get('/query/models', controller.listQueryModels);
    router.get('/query/providers', controller.listQueryProviders);
    router.get('/query/conversations/:conversationId', requireAdminUser, controller.getConversationHistory);

    router.get('/query/prompts/hooks', controller.listPromptHooks);
    router.get('/query/prompts', controller.listPrompts);
    router.post('/query/prompts', controller.savePrompt);
    router.post('/query/prompts/:id/run', controller.runPrompt);
    router.delete('/query/prompts/:id', controller.deletePrompt);

    router.get('/activity', controller.listActivity);
    router.get('/activity/:id', controller.getActivity);

    router.get('/approvals', controller.listApprovals);
    router.get('/approvals/count', controller.getApprovalsCount);
    router.post('/approvals/:id/approve', controller.approve);
    router.post('/approvals/:id/reject', controller.reject);

    router.get('/policy', controller.getPolicy);
    // Writing a policy override is how a tool's safety gates come off — an
    // override can grant `allowUnattended` (letting an external tool run on an
    // autonomous path) or set `curation: 'auto-approve'` (releasing its held
    // effects with no human review). Clearing one is the same authority in
    // reverse. Reading the overrides stays on the shared gate above; only the
    // writes are narrowed, so a monitoring script can still see the posture it
    // is no longer allowed to change.
    router.put('/policy/:name', requireAdminUser, controller.setPolicy);
    router.delete('/policy/:name', requireAdminUser, controller.clearPolicy);

    return router;
}
