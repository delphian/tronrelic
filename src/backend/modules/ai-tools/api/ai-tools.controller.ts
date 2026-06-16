/**
 * @file ai-tools.controller.ts
 *
 * Admin HTTP handlers for the AI tool governance surface: the tool registry
 * with capability badges and enable toggles, the live invocation audit feed,
 * the approval queue, and the policy editor. Mounted under
 * `/api/admin/system/ai-tools`. The `/system/ai-tools` dashboard renders these;
 * the endpoints are the provider-neutral source of truth.
 */

import type { Request, Response } from 'express';
import type { ICurationItem, IToolPolicy, ToolInvocationStatus, ToolTriggerPath } from '@/types';
import type { AiToolRegistry } from '../services/ai-tool-registry.js';
import type { ToolPolicyEngine } from '../services/tool-policy-engine.js';
import type { ToolAuditStore, IToolInvocationQuery } from '../services/tool-audit-store.js';
import type { ToolApprovalQueue } from '../services/tool-approval-queue.js';
import type { AiToolGovernor } from '../services/ai-tool-governor.js';
import type { AiProviderRegistry } from '../services/ai-provider-registry.js';
import type { CurationService } from '../services/curation-service.js';
import { detectTrifecta } from '../services/trifecta-detector.js';

/**
 * Serialize a curation envelope for the admin dashboard: dates to ISO strings,
 * and only the fields the queue UI needs (including `ref`, which the type's
 * editor uses to address its own record). Drops the Mongo `_id`.
 *
 * @param item - The stored envelope.
 * @returns A JSON-safe view of the item.
 */
function serializeCurationItem(item: ICurationItem): Record<string, unknown> {
    return {
        id: item.id,
        typeId: item.typeId,
        providerId: item.providerId,
        ref: item.ref,
        preview: item.preview,
        status: item.status,
        source: item.source,
        createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : item.createdAt,
        decidedAt: item.decidedAt instanceof Date ? item.decidedAt.toISOString() : item.decidedAt,
        decidedBy: item.decidedBy
    };
}

/**
 * Read the Better Auth admin id `requireAdmin` set on the request, for audit
 * attribution. Undefined when the call authenticated via the service token.
 *
 * @param req - The admin request.
 * @returns The admin user id, or undefined.
 */
function actorId(req: Request): string | undefined {
    return (req as Request & { userId?: string }).userId;
}

/**
 * Handlers for the AI tool admin API. Methods are bound arrow properties so
 * they can be passed directly to the router.
 */
export class AiToolsController {
    /**
     * @param registry - Tool registry.
     * @param policy - Policy engine.
     * @param audit - Invocation audit store.
     * @param approvals - Approval queue.
     * @param governor - Tool governor (for approve/reject execution).
     * @param providers - Installed-AI-provider registry (for the Provider panel).
     * @param curation - Central curation queue (for the Curation tab).
     */
    constructor(
        private readonly registry: AiToolRegistry,
        private readonly policy: ToolPolicyEngine,
        private readonly audit: ToolAuditStore,
        private readonly approvals: ToolApprovalQueue,
        private readonly governor: AiToolGovernor,
        private readonly providers: AiProviderRegistry,
        private readonly curation: CurationService
    ) {}

    /** GET /tools — registry with capability, provider, and enabled state. */
    listTools = async (_req: Request, res: Response): Promise<void> => {
        res.json({ tools: this.registry.listToolInfo() });
    };

    /** PATCH /tools/:name — toggle a tool's enabled state. */
    setToolEnabled = async (req: Request, res: Response): Promise<void> => {
        const enabled = (req.body as { enabled?: unknown })?.enabled;
        if (typeof enabled !== 'boolean') {
            res.status(400).json({ error: 'Body must include a boolean "enabled".' });
            return;
        }
        const updated = await this.registry.setEnabled(req.params.name, enabled);
        if (!updated) {
            res.status(404).json({ error: `Tool "${req.params.name}" is not registered.` });
            return;
        }
        res.json({ name: req.params.name, enabled });
    };

    /** GET /trifecta — lethal-trifecta status over the enabled tool set. */
    getTrifecta = async (_req: Request, res: Response): Promise<void> => {
        res.json(detectTrifecta(this.registry.listToolInfo()));
    };

    /** GET /providers — installed AI provider plugins for the Provider panel. */
    listProviders = async (_req: Request, res: Response): Promise<void> => {
        res.json({ providers: this.providers.listProviders() });
    };

    /** GET /activity — paged invocation audit feed with filters. */
    listActivity = async (req: Request, res: Response): Promise<void> => {
        const query: IToolInvocationQuery = {};
        if (typeof req.query.toolName === 'string') {
            query.toolName = req.query.toolName;
        }
        if (typeof req.query.providerId === 'string') {
            query.providerId = req.query.providerId;
        }
        if (typeof req.query.aiProviderId === 'string') {
            query.aiProviderId = req.query.aiProviderId;
        }
        if (typeof req.query.triggerPath === 'string') {
            query.triggerPath = req.query.triggerPath as ToolTriggerPath;
        }
        if (typeof req.query.status === 'string') {
            query.status = req.query.status as ToolInvocationStatus;
        }
        if (typeof req.query.limit === 'string') {
            const parsed = Number.parseInt(req.query.limit, 10);
            if (!Number.isNaN(parsed)) {
                query.limit = parsed;
            }
        }
        if (typeof req.query.offset === 'string') {
            const parsed = Number.parseInt(req.query.offset, 10);
            if (!Number.isNaN(parsed)) {
                query.offset = parsed;
            }
        }
        const page = await this.audit.list(query);
        res.json(page);
    };

    /** GET /activity/:id — one invocation record. */
    getActivity = async (req: Request, res: Response): Promise<void> => {
        const record = await this.audit.getById(req.params.id);
        if (!record) {
            res.status(404).json({ error: 'Invocation record not found.' });
            return;
        }
        res.json(record);
    };

    /** GET /approvals — pending held invocations awaiting human decision. */
    listApprovals = async (_req: Request, res: Response): Promise<void> => {
        res.json({ approvals: await this.approvals.listPending() });
    };

    /** GET /approvals/count — pending approval count for the nav badge. */
    getApprovalsCount = async (_req: Request, res: Response): Promise<void> => {
        res.json({ count: await this.approvals.countPending() });
    };

    /** POST /approvals/:id/approve — approve and run a held invocation. */
    approve = async (req: Request, res: Response): Promise<void> => {
        const result = await this.governor.approve(req.params.id, actorId(req));
        if (!result) {
            res.status(404).json({ error: 'No pending approval matched that id.' });
            return;
        }
        res.json(result);
    };

    /** POST /approvals/:id/reject — reject a held invocation without running it. */
    reject = async (req: Request, res: Response): Promise<void> => {
        const request = await this.governor.reject(req.params.id, actorId(req));
        if (!request) {
            res.status(404).json({ error: 'No pending approval matched that id.' });
            return;
        }
        res.json(request);
    };

    /** GET /policy — per-tool overrides and usage tallies. */
    getPolicy = async (_req: Request, res: Response): Promise<void> => {
        res.json({ overrides: this.policy.getOverrides(), usage: this.policy.snapshot() });
    };

    /** PUT /policy/:name — set a per-tool policy override. */
    setPolicy = async (req: Request, res: Response): Promise<void> => {
        const policy = req.body as IToolPolicy;
        if (!policy || typeof policy !== 'object') {
            res.status(400).json({ error: 'Body must be a policy object.' });
            return;
        }
        await this.policy.setOverride(req.params.name, policy);
        res.json({ name: req.params.name, policy });
    };

    /** DELETE /policy/:name — clear a per-tool override (revert to class defaults). */
    clearPolicy = async (req: Request, res: Response): Promise<void> => {
        await this.policy.setOverride(req.params.name, null);
        res.json({ name: req.params.name, cleared: true });
    };

    /** GET /curations — pending items held across every content type. */
    listCurations = async (_req: Request, res: Response): Promise<void> => {
        const items = await this.curation.listPending();
        res.json({ curations: items.map(serializeCurationItem) });
    };

    /** GET /curations/count — pending curation count for the nav badge. */
    getCurationsCount = async (_req: Request, res: Response): Promise<void> => {
        res.json({ count: await this.curation.countPending() });
    };

    /** POST /curations/:id/approve — approve a held item and commit it via its type. */
    approveCuration = async (req: Request, res: Response): Promise<void> => {
        await this.decideCuration(req, res, 'approve');
    };

    /** POST /curations/:id/reject — reject a held item and discard it via its type. */
    rejectCuration = async (req: Request, res: Response): Promise<void> => {
        await this.decideCuration(req, res, 'reject');
    };

    /** PATCH /curations/:id — apply an operator's inline edit to a held item. */
    editCuration = async (req: Request, res: Response): Promise<void> => {
        const id = req.params.id;
        const body = (req.body as { body?: unknown })?.body;
        if (typeof body !== 'string') {
            res.status(400).json({ error: 'Body must include a string "body".' });
            return;
        }
        const item = await this.curation.get(id);
        if (!item || item.status !== 'pending') {
            res.status(404).json({ error: 'No pending curation item matched that id.' });
            return;
        }
        if (!this.curation.hasType(item.typeId)) {
            res.status(409).json({ error: 'The owning provider is unavailable; this item cannot be edited until it is re-enabled.' });
            return;
        }
        if (!this.curation.getType(item.typeId)?.applyEdit) {
            res.status(409).json({ error: 'This content type does not support inline editing.' });
            return;
        }
        try {
            // The owning type validates the patch (e.g. tweet length) and may
            // throw; surface that as a 400 the operator can correct from.
            const updated = await this.curation.edit(id, { body }, actorId(req));
            if (!updated) {
                res.status(409).json({ error: 'Curation item could not be edited; it may have just been resolved.' });
                return;
            }
            res.json(serializeCurationItem(updated));
        } catch (error) {
            res.status(400).json({ error: error instanceof Error ? error.message : 'Edit rejected.' });
        }
    };

    /**
     * Shared approve/reject path. Distinguishes the not-pending case (404) from a
     * blocked decision whose owning provider is disabled (409) so the operator
     * sees why an item cannot be actioned, then delegates to the service.
     *
     * @param req - The admin request (`:id` param, admin actor).
     * @param res - The response.
     * @param action - Which terminal decision to apply.
     * @returns Resolves once a response is sent.
     */
    private decideCuration = async (req: Request, res: Response, action: 'approve' | 'reject'): Promise<void> => {
        const id = req.params.id;
        const item = await this.curation.get(id);
        if (!item || item.status !== 'pending') {
            res.status(404).json({ error: 'No pending curation item matched that id.' });
            return;
        }
        if (!this.curation.hasType(item.typeId)) {
            res.status(409).json({
                error: 'The owning provider is unavailable; this item cannot be decided until it is re-enabled.'
            });
            return;
        }
        try {
            const result = action === 'approve'
                ? await this.curation.approve(id, actorId(req))
                : await this.curation.reject(id, actorId(req));
            if (!result) {
                res.status(409).json({ error: 'Curation item could not be decided; it may have just been resolved.' });
                return;
            }
            res.json(serializeCurationItem(result));
        } catch (error) {
            // The decision was recorded but the owning type could not complete the
            // effect (publish/cleanup failed). The item has left the pending queue,
            // so surface the failure rather than reporting a false success.
            res.status(502).json({
                error: `Decision recorded, but the provider could not complete it: ${error instanceof Error ? error.message : String(error)}`
            });
        }
    };
}
