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
import type { IToolPolicy, ToolInvocationStatus, ToolTriggerPath } from '@/types';
import type { AiToolRegistry } from '../services/ai-tool-registry.js';
import type { ToolPolicyEngine } from '../services/tool-policy-engine.js';
import type { ToolAuditStore, IToolInvocationQuery } from '../services/tool-audit-store.js';
import type { ToolApprovalQueue } from '../services/tool-approval-queue.js';
import type { AiToolGovernor } from '../services/ai-tool-governor.js';
import type { AiProviderRegistry } from '../services/ai-provider-registry.js';
import { detectTrifecta } from '../services/trifecta-detector.js';

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
     */
    constructor(
        private readonly registry: AiToolRegistry,
        private readonly policy: ToolPolicyEngine,
        private readonly audit: ToolAuditStore,
        private readonly approvals: ToolApprovalQueue,
        private readonly governor: AiToolGovernor,
        private readonly providers: AiProviderRegistry
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
}
