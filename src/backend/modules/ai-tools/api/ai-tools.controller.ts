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
    IAiStreamChunk,
    IAiToolInfo,
    IModelInfo,
    IStaticPromptVariable,
    IToolPolicy,
    ITrifectaStatus,
    IUntrustedScreenConfig,
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
import { buildAiQueryRecord } from '../services/ai-query-history.service.js';
import type { SavedPromptsService } from '../services/saved-prompts.service.js';
import { SavedPromptValidationError, type ISavedPromptTriggerInput } from '../services/saved-prompts.service.js';
import type { EndUserResolver } from '../services/end-user-resolver.js';
import type { PromptVariableRegistry } from '../services/prompt-variable-registry.js';
import { PromptVariableValidationError } from '../services/prompt-variable-registry.js';
import type { SystemPromptsService } from '../services/system-prompts.service.js';
import { SystemPromptValidationError } from '../services/system-prompts.service.js';
import type { ScreenConfigService } from '../services/screen-config.service.js';
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
    toolAllowlist?: unknown;
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
 * Validate a client-supplied `toolAllowlist` from a query body. The selector is
 * a model-independent guarantee — the schema advertised to the model is only a
 * hint — so a malformed value must be rejected before it reaches the provider,
 * where a non-array would otherwise be forwarded and silently read as "all
 * tools". Legal shapes on the query path are `undefined` (omit → all enabled
 * tools) or an array of non-empty strings (`[]` for none, a name list for a
 * subset); `null`, non-arrays, blank entries, and entries with leading/trailing
 * whitespace are rejected. Returns a descriptive error string on the
 * first problem, or null when valid.
 *
 * @param value - The raw `toolAllowlist` value from the request body.
 * @returns An error message, or null when valid.
 */
function validateToolAllowlist(value: unknown): string | null {
    if (value === undefined) {
        return null;
    }
    if (!Array.isArray(value)) {
        return 'Body field "toolAllowlist" must be an array of tool-name strings.';
    }
    for (let i = 0; i < value.length; i += 1) {
        if (typeof value[i] !== 'string' || !value[i].trim()) {
            return `toolAllowlist[${i}] must be a non-empty string.`;
        }
        if (value[i] !== value[i].trim()) {
            return `toolAllowlist[${i}] must not have leading or trailing whitespace.`;
        }
    }
    return null;
}

/**
 * Translate the legacy flat `cron`/`scheduleEnabled` save-prompt body fields
 * into the unified `triggers` input, for editor clients that predate the
 * `triggers[]` schema (removed once the chunk-3b editor lands). Semantics
 * mirror the old flat contract: both fields absent preserves the existing
 * triggers (`undefined`); a `null`/empty cron clears them (`null`); a cron
 * string becomes one cron trigger element honouring `scheduleEnabled`.
 *
 * @param cron - The raw legacy cron body value.
 * @param scheduleEnabled - The raw legacy enable flag.
 * @returns A `triggers` input equivalent to the legacy request.
 */
function legacyCronToTriggers(cron: unknown, scheduleEnabled: unknown): ISavedPromptTriggerInput[] | null | undefined {
    if (cron === undefined) {
        return undefined;
    }
    if (cron === null || (typeof cron === 'string' && !cron.trim())) {
        return null;
    }
    return [{
        kind: 'cron',
        cron: typeof cron === 'string' ? cron : String(cron),
        enabled: scheduleEnabled !== false
    }];
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
     * @param history - Core query-history store (for the Query tab).
     * @param savedPrompts - Saved prompt templates + cron scheduling (Query tab).
     * @param promptVariables - Prompt variable registry (Registry tab Variables section + trifecta secret-leg feed).
     * @param systemPrompts - Core system-prompts service (Registry tab System Prompts section + per-query injection composition).
     * @param resolveEndUser - Maps a Better Auth user id to the live end-user principal the governor scopes user-owned-object tools to (interactive query attribution + prompt-owner labelling).
     */
    constructor(
        private readonly registry: AiToolRegistry,
        private readonly policy: ToolPolicyEngine,
        private readonly audit: ToolAuditStore,
        private readonly approvals: ToolApprovalQueue,
        private readonly governor: AiToolGovernor,
        private readonly providers: AiProviderRegistry,
        private readonly history: AiQueryHistoryService,
        private readonly savedPrompts: SavedPromptsService,
        private readonly promptVariables: PromptVariableRegistry,
        private readonly systemPrompts: SystemPromptsService,
        private readonly resolveEndUser: EndUserResolver,
        private readonly screenConfig: ScreenConfigService
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
     * GET /trifecta — lethal-trifecta status over the whole enabled tool set.
     * The dashboard's page-level banner; scoping is the preview endpoint below.
     */
    getTrifecta = async (_req: Request, res: Response): Promise<void> => {
        res.json(await this.computeTrifecta());
    };

    /**
     * POST /trifecta/preview — lethal-trifecta status scoped to a hypothetical
     * tool allowlist, backing the saved-prompt editor's per-run badge.
     *
     * The body's `toolAllowlist` narrows only the governed registry tools — the
     * set an allowlist actually controls. Provider server-tools and secret prompt
     * variables are folded in unchanged, because a per-prompt allowlist cannot
     * disable them (they run/inject regardless of which governed tools a run
     * selects), so an honest per-run verdict must still count their legs. The
     * selector is re-validated with the same guard the query and save paths use.
     */
    previewTrifecta = async (req: Request, res: Response): Promise<void> => {
        const raw = (req.body as { toolAllowlist?: unknown })?.toolAllowlist;
        const allowlistError = validateToolAllowlist(raw);
        if (allowlistError) {
            res.status(400).json({ error: allowlistError });
            return;
        }
        res.json(await this.computeTrifecta(raw as string[] | undefined));
    };

    /**
     * Compute the lethal-trifecta verdict, optionally scoped to a tool allowlist.
     *
     * Folds the active provider's enabled server-side tools (Anthropic's
     * `web_search` / `web_fetch`) in alongside the governed registry tools. Those
     * tools execute outside `governor.invoke()`, so the registry cannot see them;
     * counting them keeps the verdict honest — a `web_fetch` contributes both an
     * untrusted-content ingress and an open egress leg, which turns an otherwise
     * `safe` posture `lethal` when a secret reader is also present.
     *
     * @param allowlist - When provided, restricts the governed registry tools to
     *        these names (`undefined` = every registered tool, the global posture;
     *        `[]` = no governed tools; a list = that subset). Server-tools and
     *        secret variables are always included — the allowlist does not gate
     *        them, and a saved prompt runs with them regardless of its selection.
     * @returns The trifecta status for the resulting tool set.
     */
    private async computeTrifecta(allowlist?: string[]): Promise<ITrifectaStatus> {
        const registryTools = this.registry.listToolInfo();
        const scoped = allowlist === undefined
            ? registryTools
            : registryTools.filter(tool => allowlist.includes(tool.name));
        // The provider half ships in a separate repo and deploys independently,
        // so a version-skewed active provider may predate listActiveServerTools
        // (the provider registry does not validate the instance shape), and the
        // call itself reads provider state that can throw. Guard both — a missing
        // method or a throw degrades to a registry-only verdict instead of 500ing
        // the caller.
        let serverTools: IAiToolInfo[] = [];
        try {
            const provider = this.providers.getActive();
            if (provider && typeof provider.listActiveServerTools === 'function') {
                serverTools = (await provider.listActiveServerTools()) ?? [];
            }
        } catch {
            serverTools = [];
        }
        return detectTrifecta(
            [...scoped, ...serverTools],
            (name, cap) => this.policy.isEgressGated(name, cap),
            this.promptVariables.getSecretVariableNames()
        );
    }

    /** GET /providers — installed AI provider plugins for the Provider panel. */
    listProviders = async (_req: Request, res: Response): Promise<void> => {
        res.json({ providers: this.providers.listProviders() });
    };

    /** GET /screen-config — the untrusted-content output screen policy. */
    getScreenConfig = async (_req: Request, res: Response): Promise<void> => {
        res.json(this.screenConfig.get());
    };

    /**
     * PUT /screen-config — update the untrusted-content output screen policy.
     *
     * Accepts a partial body; each field is validated and unknown/ill-typed
     * fields are rejected with 400 rather than silently dropped (the service also
     * normalizes, but a 400 tells the admin their input was wrong instead of
     * appearing to accept it). Returns the full effective config after the patch.
     */
    setScreenConfig = async (req: Request, res: Response): Promise<void> => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const patch: Partial<IUntrustedScreenConfig> = {};
        let error: string | null = null;

        if (body.enabled !== undefined) {
            if (typeof body.enabled !== 'boolean') {
                error = '"enabled" must be a boolean.';
            } else {
                patch.enabled = body.enabled;
            }
        }
        if (error === null && body.postureMode !== undefined) {
            if (body.postureMode !== 'always' && body.postureMode !== 'trifecta') {
                error = '"postureMode" must be "always" or "trifecta".';
            } else {
                patch.postureMode = body.postureMode;
            }
        }
        if (error === null && body.onFailure !== undefined) {
            if (body.onFailure !== 'open' && body.onFailure !== 'closed') {
                error = '"onFailure" must be "open" or "closed".';
            } else {
                patch.onFailure = body.onFailure;
            }
        }
        if (error === null && body.offenderThreshold !== undefined) {
            if (typeof body.offenderThreshold !== 'number' || !Number.isFinite(body.offenderThreshold) || body.offenderThreshold < 0) {
                error = '"offenderThreshold" must be a non-negative number.';
            } else {
                patch.offenderThreshold = body.offenderThreshold;
            }
        }
        if (error !== null) {
            res.status(400).json({ error });
            return;
        }
        const updated = await this.screenConfig.update(patch);
        res.json(updated);
    };

    /** GET /variables — every prompt variable (dynamic + static) with classification and size. */
    listVariables = async (_req: Request, res: Response): Promise<void> => {
        try {
            res.json({ variables: await this.promptVariables.listInfo() });
        } catch {
            res.status(500).json({ error: 'Failed to load prompt variables.' });
        }
    };

    /** POST /variables — create an admin-authored static variable. */
    createVariable = async (req: Request, res: Response): Promise<void> => {
        const { name, description, category, content, sensitivity } = (req.body ?? {}) as Record<string, unknown>;
        try {
            const created = await this.promptVariables.createStatic({
                name: name as string,
                description: description as string,
                category: category as string,
                content: content as string,
                sensitivity: sensitivity as IStaticPromptVariable['sensitivity'] | undefined
            });
            res.json({ variable: created });
        } catch (error: unknown) {
            this.sendVariableError(res, error, 'Failed to create variable.');
        }
    };

    /** PATCH /variables/:name — edit a static variable's mutable fields. */
    updateVariable = async (req: Request, res: Response): Promise<void> => {
        const { description, category, content, sensitivity } = (req.body ?? {}) as Record<string, unknown>;
        try {
            const updated = await this.promptVariables.updateStatic(req.params.name, {
                description: description as string | undefined,
                category: category as string | undefined,
                content: content as string | undefined,
                sensitivity: sensitivity as IStaticPromptVariable['sensitivity'] | undefined
            });
            res.json({ variable: updated });
        } catch (error: unknown) {
            this.sendVariableError(res, error, 'Failed to update variable.');
        }
    };

    /** DELETE /variables/:name — delete a static variable. */
    deleteVariable = async (req: Request, res: Response): Promise<void> => {
        try {
            const removed = await this.promptVariables.deleteStatic(req.params.name);
            if (!removed) {
                res.status(404).json({ error: 'Variable not found.' });
                return;
            }
            res.json({ success: true });
        } catch (error: unknown) {
            this.sendVariableError(res, error, 'Failed to delete variable.');
        }
    };

    /** PUT /variables/:name/classification — set a variable's sensitivity (works for both kinds). */
    classifyVariable = async (req: Request, res: Response): Promise<void> => {
        const sensitivity = (req.body as { sensitivity?: unknown })?.sensitivity;
        if (sensitivity !== 'public' && sensitivity !== 'internal' && sensitivity !== 'secret') {
            res.status(400).json({ error: "Body must include sensitivity of 'public', 'internal', or 'secret'." });
            return;
        }
        try {
            const info = await this.promptVariables.classify(req.params.name, sensitivity);
            res.json({ variable: info });
        } catch (error: unknown) {
            this.sendVariableError(res, error, 'Failed to classify variable.');
        }
    };

    /**
     * GET /variables/:name/value — resolve a single variable to its *current*
     * runtime value so an admin can inspect what a `{%name%}` token holds right
     * now, without composing a query. A dynamic resolver runs live here, so the
     * value reflects this instant; a static variable returns its stored constant.
     *
     * Kept off the bulk `listVariables` payload deliberately: a resolved value may
     * be large or `secret`, so it is fetched only when an operator expands the row
     * that needs it. Admin-gated and rate-limited by the router — the same posture
     * that already lets an admin create, edit, and classify these variables.
     *
     * A resolver that currently throws is itself the "current state" the admin is
     * inspecting, so its message is surfaced (502) rather than hidden; an unknown
     * name is a 404.
     */
    revealVariable = async (req: Request, res: Response): Promise<void> => {
        const name = req.params.name;
        try {
            const content = await this.promptVariables.resolve(name);
            res.json({
                variable: {
                    name,
                    pattern: `{%${name}%}`,
                    content,
                    sizeBytes: Buffer.byteLength(content, 'utf-8')
                }
            });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to resolve variable.';
            const status = message.startsWith('Unknown prompt variable') ? 404 : 502;
            res.status(status).json({ error: message });
        }
    };

    /**
     * Map a prompt-variable failure to a response: a caller-actionable
     * {@link PromptVariableValidationError} carries its own status code (400/404/409);
     * anything else is a 500 with a generic message.
     *
     * @param res - The response.
     * @param error - The thrown error.
     * @param fallback - Generic message for an unexpected (500) failure.
     */
    private sendVariableError(res: Response, error: unknown, fallback: string): void {
        if (error instanceof PromptVariableValidationError) {
            res.status(error.statusCode).json({ error: error.message });
            return;
        }
        res.status(500).json({ error: fallback });
    }

    /** GET /system-prompts — the master prompt plus every additional prompt. */
    getSystemPrompts = async (_req: Request, res: Response): Promise<void> => {
        try {
            const [master, additional] = await Promise.all([
                this.systemPrompts.getMaster(),
                this.systemPrompts.list()
            ]);
            res.json({ master, additional });
        } catch {
            res.status(500).json({ error: 'Failed to load system prompts.' });
        }
    };

    /** PUT /system-prompts/master — replace the always-on master prompt (may be blank). */
    setMasterSystemPrompt = async (req: Request, res: Response): Promise<void> => {
        const content = (req.body as { content?: unknown })?.content;
        if (typeof content !== 'string') {
            res.status(400).json({ error: 'Body must include a string "content".' });
            return;
        }
        try {
            await this.systemPrompts.setMaster(content);
            res.json({ master: await this.systemPrompts.getMaster() });
        } catch (error: unknown) {
            this.sendSystemPromptError(res, error, 'Failed to save master system prompt.');
        }
    };

    /**
     * POST /system-prompts — create (no `id`) or update (with `id`) an additional
     * audience-scoped prompt. Responds with the full refreshed `{ master,
     * additional }` so the client's shared state stays current in one round-trip.
     */
    saveSystemPrompt = async (req: Request, res: Response): Promise<void> => {
        const { id, name, content, userIds, groups, enabled, order } = (req.body ?? {}) as {
            id?: unknown;
            name?: unknown;
            content?: unknown;
            userIds?: unknown;
            groups?: unknown;
            enabled?: unknown;
            order?: unknown;
        };
        try {
            const hasId = typeof id === 'string' && id.trim().length > 0;
            if (hasId) {
                await this.systemPrompts.updateAdditional(id as string, { name, content, userIds, groups, enabled, order });
            } else {
                await this.systemPrompts.createAdditional({ name: name as string, content: content as string, userIds, groups, enabled, order });
            }
            const [master, additional] = await Promise.all([
                this.systemPrompts.getMaster(),
                this.systemPrompts.list()
            ]);
            res.json({ master, additional });
        } catch (error: unknown) {
            this.sendSystemPromptError(res, error, 'Failed to save system prompt.');
        }
    };

    /** DELETE /system-prompts/:id — delete an additional prompt by id. */
    deleteSystemPrompt = async (req: Request, res: Response): Promise<void> => {
        try {
            const removed = await this.systemPrompts.deleteAdditional(req.params.id);
            if (!removed) {
                res.status(404).json({ error: 'System prompt not found.' });
                return;
            }
            res.json({ success: true });
        } catch (error: unknown) {
            this.sendSystemPromptError(res, error, 'Failed to delete system prompt.');
        }
    };

    /**
     * Map a system-prompt failure to a response: a caller-actionable
     * {@link SystemPromptValidationError} carries its own status code (400/404);
     * anything else is a 500 with a generic message.
     *
     * @param res - The response.
     * @param error - The thrown error.
     * @param fallback - Generic message for an unexpected (500) failure.
     */
    private sendSystemPromptError(res: Response, error: unknown, fallback: string): void {
        if (error instanceof SystemPromptValidationError) {
            res.status(error.statusCode).json({ error: error.message });
            return;
        }
        res.status(500).json({ error: fallback });
    }

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

        // `toolAllowlist` is the least-privilege selector for this run. Re-check
        // it here — the provider forwards it straight into governor enforcement,
        // so a malformed value must fail as a 400 rather than degrade to "all
        // tools". undefined → omit (all enabled tools); `[]` → none; a name list
        // → that subset (enforced at governor.invoke()).
        const allowlistError = validateToolAllowlist(body.toolAllowlist);
        if (allowlistError) {
            res.status(400).json({ error: allowlistError });
            return;
        }
        const toolAllowlist = body.toolAllowlist as string[] | undefined;

        // The admin driving this query is its end-user principal: on the
        // interactive path the operator queries on their own behalf. requireAdmin
        // set req.userId on the session path (undefined for a service-token call,
        // which then carries no principal). Forwarded to the provider as
        // `endUser` so a tool declaring operatesOnUserOwnedObjects scopes to the
        // admin's own objects rather than being denied; the principal's groups,
        // email, and wallet are resolved live from the accounts directory.
        const callerId = actorId(req);
        const endUser = (callerId ? await this.resolveEndUser(callerId) : null) ?? undefined;

        // Compose the core-injected system prompt for this principal: the
        // always-on master plus any audience-scoped prompts whose userIds/groups
        // match the admin. Already {%name%}-expanded by core, the provider injects
        // it after its security clause and before its own config.systemPrompt. A
        // compose failure must not 500 the whole query — degrade to no injection
        // and let the query run with the provider's own prompt.
        let injectedSystemPrompt: string | undefined;
        try {
            injectedSystemPrompt = await this.systemPrompts.compose(endUser ?? null);
        } catch {
            injectedSystemPrompt = undefined;
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
                    { prompt, queryId, model, messages, conversationId, mode: 'stream', endUser, injectedSystemPrompt, toolAllowlist },
                    (chunk: IAiStreamChunk) => {
                        WebSocketService.getInstance().emitToSocket(socketId, QUERY_STREAM_EVENT, chunk);
                    }
                )
                .then((result) => {
                    void this.history.append(
                        buildAiQueryRecord('stream', prompt, conversationId, createdAt, queryId, result, null)
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
                        buildAiQueryRecord(
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
            const result = await provider.query({ prompt, model, messages, conversationId, mode: 'programmatic', endUser, injectedSystemPrompt, toolAllowlist });
            await this.history.append(
                buildAiQueryRecord('programmatic', prompt, conversationId, createdAt, randomUUID(), result, null)
            );
            res.json({ result });
        } catch (error: unknown) {
            await this.history.append(
                buildAiQueryRecord(
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

    /**
     * GET /query/providers — every registered AI provider with its model
     * catalog, for the cross-provider saved-prompt model picker. Unlike
     * `/query/models` (active provider only), this enumerates all registered
     * providers so a prompt can be pinned to a model on a non-active provider.
     * Each provider's `listModels()` is guarded independently: a vendor-API
     * failure on one provider yields an empty model list for that provider
     * rather than failing the whole response, and the providers are resolved in
     * parallel so one slow vendor does not serialize the rest.
     */
    listQueryProviders = async (_req: Request, res: Response): Promise<void> => {
        const providers = await Promise.all(
            this.providers.listProviders().map(async (info) => {
                let models: IModelInfo[] = [];
                try {
                    const instance = this.providers.getProvider(info.id);
                    if (instance) {
                        models = await instance.listModels();
                    }
                } catch {
                    models = [];
                }
                return { id: info.id, label: info.label, active: info.active, models };
            })
        );
        res.json({ providers });
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
        const { id, name, prompt, triggers, cron, scheduleEnabled, providerId, model, toolAllowlist } = (req.body ?? {}) as {
            id?: unknown;
            name?: unknown;
            prompt?: unknown;
            triggers?: unknown;
            cron?: unknown;
            scheduleEnabled?: unknown;
            providerId?: unknown;
            model?: unknown;
            toolAllowlist?: unknown;
        };
        try {
            // The editor sends the unified `triggers` array. Until the editor UI
            // migrates (chunk 3b), the legacy flat `cron`/`scheduleEnabled` body
            // fields are still accepted and translated into a single cron
            // trigger element so the pre-triggers UI keeps working; `triggers`
            // wins when both are present.
            const effectiveTriggers = triggers !== undefined
                ? (triggers as ISavedPromptTriggerInput[] | null)
                : legacyCronToTriggers(cron, scheduleEnabled);
            const hasId = typeof id === 'string' && id.trim().length > 0;
            if (hasId) {
                await this.savedPrompts.update(id as string, {
                    name: name as string | undefined,
                    prompt: prompt as string | undefined,
                    triggers: effectiveTriggers,
                    providerId: providerId as string | null | undefined,
                    model: model as string | null | undefined,
                    // Forwarded raw (undefined omit / null clear-to-all / array
                    // set); the service's validateToolAllowlist rejects a
                    // malformed value as a SavedPromptValidationError → 400.
                    toolAllowlist: toolAllowlist as string[] | null | undefined
                });
            } else {
                // Stamp ownership from the saving admin. requireAdmin set
                // req.userId on the session path; a service-token save has none,
                // leaving the prompt unowned (it then runs scheduled with no
                // principal). The label is a best-effort display convenience —
                // a lookup failure must never fail the save.
                const ownerUserId = actorId(req);
                let ownerLabel: string | undefined;
                if (ownerUserId) {
                    try {
                        ownerLabel = (await this.resolveEndUser(ownerUserId))?.email ?? undefined;
                    } catch {
                        ownerLabel = undefined;
                    }
                }
                await this.savedPrompts.create({
                    name: name as string,
                    prompt: prompt as string,
                    triggers: effectiveTriggers,
                    providerId: typeof providerId === 'string' ? providerId : undefined,
                    model: typeof model === 'string' ? model : undefined,
                    // Forwarded raw; the service stores an array verbatim
                    // (`[]`/`[names]`) and treats null/undefined as "all tools"
                    // (absent), rejecting a malformed value as a 400.
                    toolAllowlist: toolAllowlist as string[] | null | undefined,
                    ownerUserId,
                    ownerLabel
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
        if (typeof req.query.conversationId === 'string') {
            query.conversationId = req.query.conversationId;
        }
        if (typeof req.query.queryId === 'string') {
            query.queryId = req.query.queryId;
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

    /**
     * GET /policy — per-tool overrides, usage tallies, and the resolved
     * class-default behaviour each tool inherits. The defaults let the admin UI
     * label an inherited ("Default") cell with what it actually resolves to,
     * rather than the opaque word "Default". Computed from the same engine the
     * governor enforces with, so the displayed default cannot drift from reality.
     */
    getPolicy = async (_req: Request, res: Response): Promise<void> => {
        const defaults: Record<string, { requireApproval: boolean; allowUnattended: boolean }> = {};
        for (const tool of this.registry.listToolInfo()) {
            const base = this.policy.defaultPolicyFor(tool.capability);
            defaults[tool.name] = {
                requireApproval: base.requireApproval ?? false,
                allowUnattended: base.allowUnattended ?? false
            };
        }
        // Usage comes from the durable audit trail, not the policy engine's
        // in-memory counters — those reset on restart and left every tool reading
        // "no activity". Aggregating the persisted invocations keeps the column
        // accurate across restarts. It is non-critical: a failure here must not
        // block the policy editor, so fall back to empty tallies.
        let usage: Record<string, unknown> = {};
        try {
            usage = await this.audit.aggregateUsage();
        } catch {
            usage = {};
        }
        res.json({ overrides: this.policy.getOverrides(), usage, defaults });
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

}
