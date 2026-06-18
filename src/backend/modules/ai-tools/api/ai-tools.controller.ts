/**
 * @file ai-tools.controller.ts
 *
 * Admin HTTP handlers for the AI tool governance surface: the tool registry
 * with capability badges and enable toggles, the live invocation audit feed,
 * the approval queue, and the policy editor. Mounted under
 * `/api/admin/system/ai-tools`. The `/system/ai-tools` dashboard renders these;
 * the endpoints are the provider-neutral source of truth.
 */

import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import type {
    IAiConversationMessage,
    IAiQueryRecord,
    IAiQueryResult,
    IAiStreamChunk,
    ICurationItem,
    IToolPolicy,
    ToolInvocationStatus,
    ToolTriggerPath
} from '@/types';
import type { AiToolRegistry } from '../services/ai-tool-registry.js';
import type { ToolPolicyEngine } from '../services/tool-policy-engine.js';
import type { ToolAuditStore, IToolInvocationQuery } from '../services/tool-audit-store.js';
import type { ToolApprovalQueue } from '../services/tool-approval-queue.js';
import type { AiToolGovernor } from '../services/ai-tool-governor.js';
import type { AiProviderRegistry } from '../services/ai-provider-registry.js';
import type { AiQueryHistoryService } from '../services/ai-query-history.service.js';
import type { CurationService } from '../services/curation-service.js';
import type { SavedPromptsService } from '../services/saved-prompts.service.js';
import { SavedPromptValidationError } from '../services/saved-prompts.service.js';
import { WebSocketService } from '../../../services/websocket.service.js';
import { detectTrifecta } from '../services/trifecta-detector.js';

/** WebSocket event carrying a streamed AI response chunk to the dashboard. */
const QUERY_STREAM_EVENT = 'ai-tools:query-stream';

/** Shape of the POST /query request body. */
interface IQueryRequestBody {
    prompt?: unknown;
    queryId?: unknown;
    socketId?: unknown;
    model?: unknown;
    stream?: unknown;
    messages?: unknown;
    conversationId?: unknown;
}

/**
 * Validate a client-supplied `messages` array of prior conversation turns.
 *
 * The schema advertised to the model is only a hint; the array arrives over an
 * admin HTTP body and must be re-checked before it reaches the provider. Each
 * entry must be an object whose `role` is exactly `'user'` or `'assistant'` and
 * whose `content` is a string. Returns a descriptive error string on the first
 * malformed entry, or null when every entry is well-formed.
 *
 * @param messages - The raw `messages` value from the request body.
 * @returns An error message describing the first problem, or null when valid.
 */
function validateMessages(messages: unknown[]): string | null {
    for (let i = 0; i < messages.length; i += 1) {
        const entry = messages[i];
        if (typeof entry !== 'object' || entry === null) {
            return `messages[${i}] must be an object with "role" and "content".`;
        }
        const { role, content } = entry as { role?: unknown; content?: unknown };
        if (role !== 'user' && role !== 'assistant') {
            return `messages[${i}].role must be "user" or "assistant".`;
        }
        if (typeof content !== 'string') {
            return `messages[${i}].content must be a string.`;
        }
    }
    return null;
}

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
     * @param providers - Installed-AI-provider registry (Provider panel + active-provider actuation).
     * @param curation - Central curation queue (for the Curation tab).
     * @param history - Core query-history store (for the Query tab).
     * @param savedPrompts - Saved prompt templates + cron scheduling (Query tab).
     */
    constructor(
        private readonly registry: AiToolRegistry,
        private readonly policy: ToolPolicyEngine,
        private readonly audit: ToolAuditStore,
        private readonly approvals: ToolApprovalQueue,
        private readonly governor: AiToolGovernor,
        private readonly providers: AiProviderRegistry,
        private readonly curation: CurationService,
        private readonly history: AiQueryHistoryService,
        private readonly savedPrompts: SavedPromptsService
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

    /**
     * GET /trifecta — lethal-trifecta status over the enabled tool set.
     *
     * Folds the active provider's enabled server-side tools (Anthropic's
     * `web_search` / `web_fetch`) in alongside the governed registry tools. Those
     * tools execute outside `governor.invoke()`, so the registry cannot see them;
     * counting them here keeps the verdict honest — a `web_fetch` contributes both
     * an untrusted-content ingress and an open egress leg, which turns an
     * otherwise-`safe` posture `lethal` when a secret reader is also enabled.
     */
    getTrifecta = async (_req: Request, res: Response): Promise<void> => {
        const registryTools = this.registry.listToolInfo();
        const serverTools = await this.providers.getActive()?.listActiveServerTools() ?? [];
        res.json(detectTrifecta([...registryTools, ...serverTools], (name, cap) => this.policy.isEgressGated(name, cap)));
    };

    /** GET /providers — installed AI provider plugins for the Provider panel. */
    listProviders = async (_req: Request, res: Response): Promise<void> => {
        res.json({ providers: this.providers.listProviders() });
    };

    /**
     * POST /query — submit an AI query against the active provider.
     *
     * Streaming (default): requires `queryId` and `socketId`, fires the
     * provider's `queryStream` and emits each chunk as `ai-tools:query-stream`
     * to the requesting socket only, then responds 200 immediately — the stream
     * settles in the background and an `IAiQueryRecord` is appended to history on
     * completion or failure. On early failure a terminal error chunk is emitted
     * so the client unsticks.
     *
     * Non-streaming (`stream === false`): awaits `provider.query`, appends a
     * record, and returns the result.
     */
    query = async (req: Request, res: Response): Promise<void> => {
        const provider = this.providers.getActive();
        if (!provider) {
            res.status(503).json({ error: 'No active AI provider is installed.' });
            return;
        }

        const body = (req.body ?? {}) as IQueryRequestBody;
        const prompt = body.prompt;
        if (typeof prompt !== 'string' || prompt.trim().length === 0) {
            res.status(400).json({ error: 'Body must include a non-empty string "prompt".' });
            return;
        }

        const model = typeof body.model === 'string' ? body.model : undefined;
        const conversationId = typeof body.conversationId === 'string' ? body.conversationId : undefined;

        // `messages` is a model hint, not a guarantee — re-validate the array and
        // every entry before it reaches the provider.
        let messages: IAiConversationMessage[] | undefined;
        if (body.messages !== undefined) {
            if (!Array.isArray(body.messages)) {
                res.status(400).json({ error: 'Body field "messages" must be an array.' });
                return;
            }
            const messagesError = validateMessages(body.messages);
            if (messagesError) {
                res.status(400).json({ error: messagesError });
                return;
            }
            messages = body.messages as IAiConversationMessage[];
        }

        const stream = body.stream !== false; // default true

        if (stream) {
            const queryId = body.queryId;
            if (typeof queryId !== 'string' || queryId.trim().length === 0) {
                res.status(400).json({ error: 'Streaming queries require a non-empty string "queryId".' });
                return;
            }

            // Chunks are delivered only to the requesting socket, so the client
            // must identify it. Without it the stream has nowhere to go.
            const socketId = body.socketId;
            if (typeof socketId !== 'string' || socketId.trim().length === 0) {
                res.status(400).json({ error: 'Streaming queries require a non-empty string "socketId".' });
                return;
            }

            const createdAt = new Date().toISOString();
            // Fire-and-forget: do not await the stream. Chunks reach the client
            // over WebSocket as they arrive; the record is appended when the
            // promise settles.
            provider
                .queryStream(
                    { prompt, queryId, model, messages, conversationId, mode: 'stream' },
                    (chunk: IAiStreamChunk) => {
                        WebSocketService.getInstance().emitToSocket(socketId, QUERY_STREAM_EVENT, chunk);
                    }
                )
                .then((result) => {
                    void this.history.append(
                        this.buildRecord('stream', prompt, conversationId, createdAt, queryId, result, null)
                    );
                })
                .catch((error: unknown) => {
                    // Emit a terminal error chunk so a client still waiting on the
                    // stream unsticks. The message is sanitized — never surface
                    // provider internals or credentials to the browser.
                    const errorChunk: IAiStreamChunk = {
                        queryId,
                        type: 'error',
                        error: 'The AI query failed before completing.'
                    };
                    WebSocketService.getInstance().emitToSocket(socketId, QUERY_STREAM_EVENT, errorChunk);
                    void this.history.append(
                        this.buildRecord(
                            'stream',
                            prompt,
                            conversationId,
                            createdAt,
                            queryId,
                            null,
                            error instanceof Error ? error.message : String(error),
                            model
                        )
                    );
                });

            res.json({ success: true, queryId });
            return;
        }

        // Non-streaming path: await the result and surface it directly.
        const createdAt = new Date().toISOString();
        try {
            const result = await provider.query({ prompt, model, messages, conversationId, mode: 'programmatic' });
            await this.history.append(
                this.buildRecord('programmatic', prompt, conversationId, createdAt, randomUUID(), result, null)
            );
            res.json({ result });
        } catch (error: unknown) {
            await this.history.append(
                this.buildRecord(
                    'programmatic',
                    prompt,
                    conversationId,
                    createdAt,
                    randomUUID(),
                    null,
                    error instanceof Error ? error.message : String(error),
                    model
                )
            );
            res.status(502).json({ error: error instanceof Error ? error.message : 'AI query failed.' });
        }
    };

    /** POST /query/:queryId/cancel — abort an in-flight streaming query. */
    cancelQuery = async (req: Request, res: Response): Promise<void> => {
        const provider = this.providers.getActive();
        const canceled = provider?.cancel(req.params.queryId) ?? false;
        res.json({ canceled });
    };

    /** GET /query/history — paged query history, newest first. */
    listQueryHistory = async (req: Request, res: Response): Promise<void> => {
        const limit = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : undefined;
        const offset = typeof req.query.offset === 'string' ? Number.parseInt(req.query.offset, 10) : undefined;
        const page = await this.history.list({
            limit: Number.isNaN(limit as number) ? undefined : limit,
            offset: Number.isNaN(offset as number) ? undefined : offset
        });
        res.json(page);
    };

    /** GET /query/conversations/:conversationId — one conversation, oldest first. */
    getConversationHistory = async (req: Request, res: Response): Promise<void> => {
        const records = await this.history.getConversation(req.params.conversationId);
        res.json({ records });
    };

    /**
     * GET /query/models — list the active provider's available models.
     *
     * With no active provider installed there is nothing to list, so respond
     * `200 { models: [] }` rather than an error — the model picker simply has no
     * choices. When a provider is active, return its model list; if `listModels`
     * throws (vendor API failure, missing key), surface a 502 mirroring the
     * `query` handler's provider-error convention.
     */
    listQueryModels = async (_req: Request, res: Response): Promise<void> => {
        const provider = this.providers.getActive();
        if (!provider) {
            res.json({ models: [] });
            return;
        }
        try {
            res.json({ models: await provider.listModels() });
        } catch (error: unknown) {
            res.status(502).json({ error: error instanceof Error ? error.message : 'Failed to list AI models.' });
        }
    };

    /** GET /query/prompts — saved prompt templates, newest-updated first. */
    listPrompts = async (_req: Request, res: Response): Promise<void> => {
        try {
            res.json({ prompts: await this.savedPrompts.list() });
        } catch {
            res.status(500).json({ error: 'Failed to load saved prompts.' });
        }
    };

    /**
     * POST /query/prompts — create (no `id`) or update (with `id`) a saved
     * prompt template. Service-level `SavedPromptValidationError`s map to their
     * own status codes (400 bad input, 404 missing, 409 duplicate name); any
     * other failure is a 500. Responds with the full refreshed list so the
     * client's shared state stays current without a second round-trip.
     */
    savePrompt = async (req: Request, res: Response): Promise<void> => {
        const { id, name, prompt, cron, scheduleEnabled } = (req.body ?? {}) as {
            id?: unknown;
            name?: unknown;
            prompt?: unknown;
            cron?: unknown;
            scheduleEnabled?: unknown;
        };
        try {
            const hasId = typeof id === 'string' && id.trim().length > 0;
            if (hasId) {
                await this.savedPrompts.update(id as string, {
                    name: name as string | undefined,
                    prompt: prompt as string | undefined,
                    cron: cron as string | null | undefined,
                    scheduleEnabled: scheduleEnabled as boolean | undefined
                });
            } else {
                await this.savedPrompts.create({
                    name: name as string,
                    prompt: prompt as string,
                    cron: (cron as string | null | undefined) ?? undefined,
                    scheduleEnabled: scheduleEnabled as boolean | undefined
                });
            }
            res.json({ prompts: await this.savedPrompts.list() });
        } catch (error: unknown) {
            if (error instanceof SavedPromptValidationError) {
                res.status(error.statusCode).json({ error: error.message });
                return;
            }
            res.status(500).json({ error: 'Failed to save prompt.' });
        }
    };

    /** DELETE /query/prompts/:id — delete a saved prompt template by id. */
    deletePrompt = async (req: Request, res: Response): Promise<void> => {
        try {
            const removed = await this.savedPrompts.delete(req.params.id);
            if (!removed) {
                res.status(404).json({ error: 'Prompt not found' });
                return;
            }
            res.json({ success: true });
        } catch {
            res.status(500).json({ error: 'Failed to delete prompt.' });
        }
    };

    /**
     * Build a query-history record from a settled query. On success `result`
     * carries the model and usage; on failure `errorMessage` is set and the
     * caller's requested `model` (if any) stands in for the unknown one.
     *
     * @param mode - Execution mode the record is tagged with.
     * @param prompt - The user's prompt for this turn.
     * @param conversationId - Optional grouping id for multi-turn chat.
     * @param createdAt - ISO timestamp captured when the query started.
     * @param id - Record id (the streaming `queryId`, or a fresh uuid).
     * @param result - The successful result, or null on failure.
     * @param errorMessage - The failure reason, or null on success.
     * @param fallbackModel - Model to record when there is no result.
     * @returns A fully-built {@link IAiQueryRecord}.
     */
    private buildRecord(
        mode: IAiQueryRecord['mode'],
        prompt: string,
        conversationId: string | undefined,
        createdAt: string,
        id: string,
        result: IAiQueryResult | null,
        errorMessage: string | null,
        fallbackModel?: string
    ): IAiQueryRecord {
        return {
            id,
            mode,
            prompt,
            responseText: result?.responseText ?? null,
            model: result?.model ?? fallbackModel ?? 'unknown',
            usage: result?.usage ?? { inputTokens: 0, outputTokens: 0 },
            errorMessage,
            status: result ? 'completed' : 'failed',
            createdAt,
            completedAt: new Date().toISOString(),
            ...(conversationId ? { conversationId } : {})
        };
    }

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
        if (policy.curation !== undefined && policy.curation !== 'require' && policy.curation !== 'auto-approve') {
            res.status(400).json({ error: "curation must be 'require' or 'auto-approve'." });
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
