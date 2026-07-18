/**
 * @fileoverview Admin API client for the AI tool governance dashboard.
 *
 * Thin fetch wrappers over `/api/admin/system/ai-tools/*`. Same-origin calls
 * carry the Better Auth session cookie automatically, which the backend's
 * `requireAdmin` middleware consults — no token plumbing here. Every function
 * throws on a non-2xx response so callers surface the failure in the UI.
 */

import type {
    IAiToolInfo,
    IAiToolCapability,
    IUntrustedScreenConfig,
    AiToolSensitivity,
    ITrifectaStatus,
    IToolInvocationRecord,
    IToolInvocationContext,
    IToolPolicy,
    IAiProviderInfo,
    IAiConversationMessage,
    IAiQueryRecord,
    IAiQueryResult,
    IModelInfo,
    IPromptVariableInfo,
    IResolvedPromptVariable,
    IStaticPromptVariableInput,
    IStaticPromptVariableUpdate,
    ISavedPrompt,
    IUserGroup,
    ToolInvocationStatus,
    ToolTriggerPath
} from '@/types';

/** Base path for every AI tool admin endpoint. */
const BASE = '/api/admin/system/ai-tools';

/**
 * A tool invocation parked for human approval, as returned by `GET /approvals`.
 * Mirrors the backend `IToolApprovalRequest` (a module-internal type) using
 * platform-owned primitives so the frontend stays decoupled from core internals.
 */
export interface IPendingApproval {
    id: string;
    toolName: string;
    providerId: string;
    input: Record<string, unknown>;
    context: IToolInvocationContext;
    capability?: IAiToolCapability;
    status: string;
    createdAt: string;
    resolvedAt?: string;
    resolvedBy?: string;
}

/**
 * One page of invocation audit records plus the unpaginated total. Mirrors the
 * backend `IToolInvocationPage` exactly — the activity endpoint returns
 * `{ records, total }`, so this must not rename or add fields the server never
 * sends (a cast in `listActivity` would otherwise hide the mismatch until it
 * crashes the tab at runtime).
 */
export interface IActivityPage {
    records: IToolInvocationRecord[];
    total: number;
}

/** Filters accepted by the activity feed. */
export interface IActivityQuery {
    toolName?: string;
    providerId?: string;
    aiProviderId?: string;
    triggerPath?: ToolTriggerPath;
    status?: ToolInvocationStatus;
    /** Scope to one conversation's tool calls — backs the Query tab's per-conversation feed. */
    conversationId?: string;
    /** Scope to one run's tool calls. */
    queryId?: string;
    limit?: number;
    offset?: number;
}

/**
 * One page of AI query-history records plus the unpaginated total. Mirrors the
 * backend `IAiQueryHistoryPage` exactly — `GET /query/history` returns
 * `{ records, total }` with dates as ISO strings, so this must not rename or add
 * fields the server never sends.
 */
export interface IAiQueryHistoryPage {
    records: IAiQueryRecord[];
    total: number;
}

/** Pagination for the query-history listing. */
export interface IQueryHistoryQuery {
    limit?: number;
    offset?: number;
}

/** Per-tool policy overrides, usage tallies, and resolved class defaults, as returned by `GET /policy`. */
export interface IPolicyResponse {
    overrides: Record<string, IToolPolicy>;
    usage: Record<string, {
        invocations: number;
        allowed: number;
        denied: number;
        rateLimited: number;
        needsApproval: number;
    }>;
    /**
     * The class-default behaviour each tool inherits, before any override —
     * lets an inherited cell show what "Default" actually resolves to. Keyed by
     * tool name; a tool absent here has no resolvable default to display.
     */
    defaults: Record<string, { requireApproval: boolean; allowUnattended: boolean }>;
}

/**
 * Parse a JSON response, throwing a descriptive error on failure.
 *
 * @param response - The fetch response.
 * @param what - Human-readable description of the resource, for error text.
 * @returns The parsed JSON body.
 */
async function parse<T>(response: Response, what: string): Promise<T> {
    if (!response.ok) {
        const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(body.error || `Failed to ${what} (HTTP ${response.status})`);
    }
    return response.json() as Promise<T>;
}

/**
 * List every registered tool with capability, provider, and enabled state.
 *
 * @returns The registry tool info array.
 */
export async function listTools(): Promise<IAiToolInfo[]> {
    const data = await parse<{ tools: IAiToolInfo[] }>(await fetch(`${BASE}/tools`), 'load tools');
    return data.tools;
}

/**
 * Toggle a tool's enabled state.
 *
 * @param name - The tool name.
 * @param enabled - Target enabled state.
 * @returns Resolves when persisted.
 */
export async function setToolEnabled(name: string, enabled: boolean): Promise<void> {
    await parse(await fetch(`${BASE}/tools/${encodeURIComponent(name)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
    }), 'update tool');
}

/**
 * Fetch the lethal-trifecta status over the enabled tool set.
 *
 * @returns The trifecta legs and whether all three are present.
 */
export async function getTrifecta(): Promise<ITrifectaStatus> {
    return parse<ITrifectaStatus>(await fetch(`${BASE}/trifecta`), 'load trifecta status');
}

/**
 * Fetch the lethal-trifecta status scoped to a hypothetical tool allowlist, for
 * the saved-prompt editor's per-run badge. The allowlist narrows only the
 * governed registry tools; provider server-tools and secret prompt variables
 * still fold in (a per-prompt allowlist cannot disable them), so the badge
 * reflects the true posture a run with this selection would carry.
 *
 * @param toolAllowlist - The tool names the run would be allowed to call
 *        (`[]` = no tools; a list = that subset).
 * @returns The trifecta status for the scoped set.
 */
export async function getTrifectaPreview(toolAllowlist: string[]): Promise<ITrifectaStatus> {
    return parse<ITrifectaStatus>(await fetch(`${BASE}/trifecta/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolAllowlist })
    }), 'load trifecta preview');
}

/**
 * List installed AI provider plugins for the Provider panel.
 *
 * @returns The registered provider metadata.
 */
export async function listProviders(): Promise<IAiProviderInfo[]> {
    const data = await parse<{ providers: IAiProviderInfo[] }>(await fetch(`${BASE}/providers`), 'load providers');
    return data.providers;
}

/**
 * List every prompt variable (built-in dynamic + admin-authored static) with its
 * classification, kind, editability, and resolved size.
 *
 * @returns The variable info array.
 */
export async function listVariables(): Promise<IPromptVariableInfo[]> {
    const data = await parse<{ variables: IPromptVariableInfo[] }>(await fetch(`${BASE}/variables`), 'load variables');
    return data.variables;
}

/**
 * Resolve one variable to its current runtime value for on-demand inspection —
 * what a `{%name%}` token holds right now. Fetched per row when an admin expands
 * it, kept off the bulk {@link listVariables} payload because the value may be
 * large or `secret`.
 *
 * @param name - The variable name (without the `{%%}` delimiters).
 * @returns The variable's live resolved value and its byte size.
 */
export async function resolveVariable(name: string): Promise<IResolvedPromptVariable> {
    const data = await parse<{ variable: IResolvedPromptVariable }>(
        await fetch(`${BASE}/variables/${encodeURIComponent(name)}/value`),
        'reveal variable'
    );
    return data.variable;
}

/**
 * Create an admin-authored static variable.
 *
 * @param input - The new variable's fields.
 * @returns The created variable.
 */
export async function createVariable(input: IStaticPromptVariableInput): Promise<void> {
    await parse(await fetch(`${BASE}/variables`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
    }), 'create variable');
}

/**
 * Edit a static variable's mutable fields.
 *
 * @param name - The variable name.
 * @param patch - Fields to change.
 * @returns Resolves when persisted.
 */
export async function updateVariable(name: string, patch: IStaticPromptVariableUpdate): Promise<void> {
    await parse(await fetch(`${BASE}/variables/${encodeURIComponent(name)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
    }), 'update variable');
}

/**
 * Delete a static variable.
 *
 * @param name - The variable name.
 * @returns Resolves when deleted.
 */
export async function deleteVariable(name: string): Promise<void> {
    await parse(await fetch(`${BASE}/variables/${encodeURIComponent(name)}`, { method: 'DELETE' }), 'delete variable');
}

/**
 * Set a variable's sensitivity classification (works for both kinds). A `secret`
 * classification feeds the lethal-trifecta detector's private-data leg.
 *
 * @param name - The variable name.
 * @param sensitivity - The new sensitivity.
 * @returns Resolves when persisted.
 */
export async function classifyVariable(name: string, sensitivity: AiToolSensitivity): Promise<void> {
    await parse(await fetch(`${BASE}/variables/${encodeURIComponent(name)}/classification`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sensitivity })
    }), 'classify variable');
}

/**
 * Fetch a page of the invocation audit feed with optional filters.
 *
 * @param query - Filter and pagination options.
 * @returns A page of records plus the matching total.
 */
export async function listActivity(query: IActivityQuery = {}): Promise<IActivityPage> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== '') {
            params.set(key, String(value));
        }
    }
    const qs = params.toString();
    return parse<IActivityPage>(await fetch(`${BASE}/activity${qs ? `?${qs}` : ''}`), 'load activity');
}

/**
 * List pending invocations awaiting human approval.
 *
 * @returns The pending approval records.
 */
export async function listApprovals(): Promise<IPendingApproval[]> {
    const data = await parse<{ approvals: IPendingApproval[] }>(await fetch(`${BASE}/approvals`), 'load approvals');
    return data.approvals;
}

/**
 * Fetch the count of pending approvals, for the header badge.
 *
 * @returns The pending count.
 */
export async function getApprovalsCount(): Promise<number> {
    const data = await parse<{ count: number }>(await fetch(`${BASE}/approvals/count`), 'load approval count');
    return data.count;
}

/**
 * Approve a held invocation and run it.
 *
 * @param id - The held request id.
 * @returns Resolves when the request resolves.
 */
export async function approveInvocation(id: string): Promise<void> {
    await parse(await fetch(`${BASE}/approvals/${encodeURIComponent(id)}/approve`, { method: 'POST' }), 'approve invocation');
}

/**
 * Reject a held invocation without running it.
 *
 * @param id - The held request id.
 * @returns Resolves when the request resolves.
 */
export async function rejectInvocation(id: string): Promise<void> {
    await parse(await fetch(`${BASE}/approvals/${encodeURIComponent(id)}/reject`, { method: 'POST' }), 'reject invocation');
}

/**
 * Fetch per-tool policy overrides and usage tallies.
 *
 * @returns Overrides keyed by tool name plus usage counters.
 */
export async function getPolicy(): Promise<IPolicyResponse> {
    return parse<IPolicyResponse>(await fetch(`${BASE}/policy`), 'load policy');
}

/**
 * Set a per-tool policy override.
 *
 * @param name - The tool name.
 * @param policy - The override to persist.
 * @returns Resolves when persisted.
 */
export async function setPolicy(name: string, policy: IToolPolicy): Promise<void> {
    await parse(await fetch(`${BASE}/policy/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(policy)
    }), 'save policy override');
}

/**
 * Clear a per-tool policy override, reverting to class defaults.
 *
 * @param name - The tool name.
 * @returns Resolves when cleared.
 */
export async function clearPolicy(name: string): Promise<void> {
    await parse(await fetch(`${BASE}/policy/${encodeURIComponent(name)}`, { method: 'DELETE' }), 'clear policy override');
}

/**
 * Body for a `POST /query`. A streaming request (the default) carries a
 * client-minted `queryId` whose stream chunks arrive over WebSocket; the prior
 * turns ride in `messages` and `conversationId` groups the multi-turn chat. A
 * non-streaming request sets `stream: false` and resolves to a result inline.
 *
 * `socketId` is the id of the live core socket the caller subscribes on. The
 * backend scopes `ai-tools:query-stream` chunks to that single socket instead of
 * broadcasting globally, so other admin sessions never receive this query's
 * deltas. Required for a streaming request.
 *
 * `toolAllowlist` narrows which tools this one run may call, enforced at the
 * governor. Unlike a saved prompt (which persists a three-state field), an
 * ad-hoc query has nothing to persist, so the composer always sends the explicit
 * array: `[]` grants no tools (the safe default), a name list grants that subset.
 * Omit entirely to leave the run at the contract default (all enabled tools).
 */
export interface IQueryRequest {
    prompt: string;
    queryId?: string;
    socketId?: string;
    model?: string;
    stream?: boolean;
    messages?: IAiConversationMessage[];
    conversationId?: string;
    toolAllowlist?: string[];
}

/**
 * The acknowledgement for a streaming `POST /query`. The HTTP call returns
 * immediately with the echoed `queryId`; the response itself streams as
 * `ai-tools:query-stream` WebSocket chunks the caller filters by that id.
 */
export interface IStreamAck {
    success: true;
    queryId: string;
}

/**
 * Submit an AI query against the active provider. Streaming (the default) resolves
 * to a `{ success, queryId }` acknowledgement and the answer arrives over the
 * `ai-tools:query-stream` WebSocket event; non-streaming (`stream: false`)
 * resolves to `{ result }`. Callers narrow on whichever they requested.
 *
 * @param request - The query body (prompt plus optional streaming/chat fields).
 * @returns The streaming acknowledgement, or the inline result for `stream: false`.
 */
export async function submitQuery(request: IQueryRequest): Promise<IStreamAck | { result: IAiQueryResult }> {
    return parse<IStreamAck | { result: IAiQueryResult }>(await fetch(`${BASE}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request)
    }), 'submit query');
}

/**
 * Cancel an in-flight streaming query. Best-effort — the stream still delivers
 * its own terminal chunk regardless, so callers need not act on the result.
 *
 * @param queryId - The streaming query id to abort.
 * @returns Whether the active provider acknowledged the cancellation.
 */
export async function cancelQuery(queryId: string): Promise<boolean> {
    const data = await parse<{ canceled: boolean }>(
        await fetch(`${BASE}/query/${encodeURIComponent(queryId)}/cancel`, { method: 'POST' }),
        'cancel query'
    );
    return data.canceled;
}

/**
 * Page through the core query history, newest first.
 *
 * @param query - Pagination options.
 * @returns A page of records plus the matching total.
 */
export async function getQueryHistory(query: IQueryHistoryQuery = {}): Promise<IAiQueryHistoryPage> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
            params.set(key, String(value));
        }
    }
    const qs = params.toString();
    return parse<IAiQueryHistoryPage>(await fetch(`${BASE}/query/history${qs ? `?${qs}` : ''}`), 'load query history');
}

/**
 * Fetch every turn of one conversation, oldest first, so the Query tab can
 * reopen a multi-turn chat in the order it was spoken.
 *
 * @param conversationId - The id grouping the conversation's turns.
 * @returns The conversation's records in chronological order.
 */
export async function getConversation(conversationId: string): Promise<IAiQueryRecord[]> {
    const data = await parse<{ records: IAiQueryRecord[] }>(
        await fetch(`${BASE}/query/conversations/${encodeURIComponent(conversationId)}`),
        'load conversation'
    );
    return data.records;
}

/**
 * List the active provider's available models for the model picker. Resolves to
 * an empty array when no provider is active, so the picker simply has no choices.
 *
 * @returns The available model metadata.
 */
export async function getQueryModels(): Promise<IModelInfo[]> {
    const data = await parse<{ models: IModelInfo[] }>(await fetch(`${BASE}/query/models`), 'load query models');
    return data.models;
}

/** One registered AI provider plus its model catalog, for the model picker. */
export interface IAiProviderModels {
    /** Provider plugin id (stored on a saved prompt's `providerId`). */
    id: string;
    /** Human-readable provider/vendor name for the picker's group label. */
    label: string;
    /** Whether this is the active transport. */
    active: boolean;
    /** Models this provider exposes; empty when its catalog could not be loaded. */
    models: IModelInfo[];
}

/**
 * List every registered AI provider with its model catalog, for the
 * cross-provider saved-prompt model picker. Unlike {@link getQueryModels} (active
 * provider only), this spans all providers so a prompt can pin a model on a
 * non-active provider. Resolves to an empty array when none are installed.
 *
 * @returns Each provider with its models.
 */
export async function getQueryProviders(): Promise<IAiProviderModels[]> {
    const data = await parse<{ providers: IAiProviderModels[] }>(
        await fetch(`${BASE}/query/providers`),
        'load query providers'
    );
    return data.providers;
}

/**
 * One trigger element in a {@link saveSavedPrompt} body — the editor's input
 * shape for a saved prompt's autonomous firing rules. Mirrors the backend
 * `ISavedPromptTriggerInput`: the server assigns ids to new elements and
 * preserves run bookkeeping for elements whose `id` matches an existing
 * trigger, so the editor always sends the complete replacement set.
 */
export interface ISavedPromptTriggerRequest {
    /** Existing trigger id to preserve bookkeeping; omit for a new element. */
    id?: string;
    /** Discriminator: a cron schedule or a declared-hook binding. */
    kind: 'cron' | 'hook';
    /** Whether the trigger fires; defaults to true when omitted. */
    enabled?: boolean;
    /** Cron expression (UTC) — required when `kind` is `'cron'`. */
    cron?: string;
    /** Declared hook descriptor id — required when `kind` is `'hook'`. */
    hookId?: string;
    /** Optional content-type filter for hook triggers (fires only on a match). */
    typeIdFilter?: string;
}

/**
 * One declared hook seam a saved prompt's hook trigger may bind to, as
 * returned by `GET /query/prompts/hooks`. The picker's option list — the
 * backend rejects any `hookId` outside this set at save time.
 */
export interface IBindableHookInfo {
    /** The declared hook descriptor id (e.g. `content.published`). */
    id: string;
    /** The hook registry's description of when the seam fires. */
    description: string;
}

/** Body for {@link saveSavedPrompt}. Omit `id` to create; supply it to update. */
export interface ISavePromptRequest {
    id?: string;
    name?: string;
    prompt?: string;
    /**
     * The prompt's complete trigger set. Tri-state: omit to leave unchanged;
     * `null` or `[]` clears every trigger; an array replaces the whole set
     * (elements carrying an existing `id` keep their run bookkeeping).
     */
    triggers?: ISavedPromptTriggerRequest[] | null;
    /** Provider plugin id the prompt targets; `''`/`null` clears the pin. Omit to leave unchanged. */
    providerId?: string | null;
    /** Model id the prompt runs on; `''`/`null` clears the pin. Omit to leave unchanged. */
    model?: string | null;
    /**
     * Tools the prompt may call. Three-state: omit to leave unchanged; `[]` for
     * no tools; a name list for that subset. `null` clears the restriction back
     * to all enabled tools. The editor sends the explicit selection.
     */
    toolAllowlist?: string[] | null;
}

/**
 * List the declared hook seams a saved prompt's hook trigger may bind to, for
 * the trigger editor's hook picker. Serves exactly the ids the backend accepts
 * at save time, so the picker can never offer an unbindable seam.
 *
 * @returns The bindable hooks with their registry descriptions.
 */
export async function listPromptTriggerHooks(): Promise<IBindableHookInfo[]> {
    const data = await parse<{ hooks: IBindableHookInfo[] }>(
        await fetch(`${BASE}/query/prompts/hooks`),
        'load bindable hooks'
    );
    return data.hooks;
}

/**
 * List every saved prompt template, newest-updated first.
 *
 * @returns The saved prompts.
 */
export async function listSavedPrompts(): Promise<ISavedPrompt[]> {
    const data = await parse<{ prompts: ISavedPrompt[] }>(await fetch(`${BASE}/query/prompts`), 'load saved prompts');
    return data.prompts;
}

/**
 * Create (no `id`) or update (with `id`) a saved prompt template. Returns the
 * full refreshed list so the caller can replace its shared state in one step.
 *
 * @param request - The prompt fields to persist.
 * @returns The updated saved-prompt list.
 */
export async function saveSavedPrompt(request: ISavePromptRequest): Promise<ISavedPrompt[]> {
    const data = await parse<{ prompts: ISavedPrompt[] }>(await fetch(`${BASE}/query/prompts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request)
    }), 'save prompt');
    return data.prompts;
}

/**
 * Delete a saved prompt template by id.
 *
 * @param id - The prompt id.
 * @returns Resolves when deleted.
 */
export async function deleteSavedPrompt(id: string): Promise<void> {
    await parse(await fetch(`${BASE}/query/prompts/${encodeURIComponent(id)}`, { method: 'DELETE' }), 'delete prompt');
}

/**
 * Execute a saved prompt immediately as a self-contained autonomous run — the
 * same path its schedule fires. The server validates upfront (the prompt exists
 * and a provider can run it) and returns as soon as the run is accepted; the
 * result lands in the Query-tab history, not inline. Rejects with the server's
 * message on an upfront rejection (404 missing prompt, 400 no provider).
 *
 * @param id - The saved prompt id to run now.
 * @returns Resolves once the run has been accepted.
 */
export async function runSavedPromptNow(id: string): Promise<void> {
    await parse(await fetch(`${BASE}/query/prompts/${encodeURIComponent(id)}/run`, { method: 'POST' }), 'run saved prompt');
}

/**
 * One core-managed additional (audience-scoped) system prompt, as returned by
 * `GET /system-prompts`. Mirrors the backend `ISystemPromptDoc` using
 * platform-owned primitives so the frontend stays decoupled from core internals.
 * `userIds` is any-of and `groups` is all-of; the two filters combine with OR.
 */
export interface ISystemPromptView {
    id: string;
    name: string;
    content: string;
    userIds: string[];
    groups: string[];
    enabled: boolean;
    order: number;
    createdAt: string;
    updatedAt: string;
}

/** The master prompt plus every additional prompt, as returned by `GET /system-prompts`. */
export interface ISystemPromptsResponse {
    master: string;
    additional: ISystemPromptView[];
}

/** Body for {@link saveSystemPrompt}. Omit `id` to create; supply it to update. */
export interface ISaveSystemPromptRequest {
    id?: string;
    name?: string;
    content?: string;
    /** Better Auth user ids this prompt targets (any-of). */
    userIds?: string[];
    /** Group ids this prompt targets (all-of). */
    groups?: string[];
    enabled?: boolean;
    order?: number;
}

/**
 * Fetch the master system prompt plus every additional audience-scoped prompt.
 *
 * @returns The master content and the additional-prompt list.
 */
export async function getSystemPrompts(): Promise<ISystemPromptsResponse> {
    return parse<ISystemPromptsResponse>(await fetch(`${BASE}/system-prompts`), 'load system prompts');
}

/**
 * Replace the always-on master system prompt. A blank string is valid — it
 * silences the master's contribution without deleting the concept.
 *
 * @param content - The new master body.
 * @returns The stored master content.
 */
export async function setMasterSystemPrompt(content: string): Promise<string> {
    const data = await parse<{ master: string }>(await fetch(`${BASE}/system-prompts/master`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
    }), 'save master system prompt');
    return data.master;
}

/**
 * Create (no `id`) or update (with `id`) an additional system prompt. Returns the
 * full refreshed `{ master, additional }` so the caller replaces its shared state
 * in one step.
 *
 * @param request - The prompt fields to persist.
 * @returns The refreshed master and additional-prompt list.
 */
export async function saveSystemPrompt(request: ISaveSystemPromptRequest): Promise<ISystemPromptsResponse> {
    return parse<ISystemPromptsResponse>(await fetch(`${BASE}/system-prompts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request)
    }), 'save system prompt');
}

/**
 * Delete an additional system prompt by id.
 *
 * @param id - The prompt id.
 * @returns Resolves when deleted.
 */
export async function deleteSystemPrompt(id: string): Promise<void> {
    await parse(await fetch(`${BASE}/system-prompts/${encodeURIComponent(id)}`, { method: 'DELETE' }), 'delete system prompt');
}

/**
 * Fetch the untrusted-content output screen policy — the master switch, when the
 * screen runs, how it fails, and the offender throttle threshold. The section
 * editor seeds its controls from this effective config.
 *
 * @returns The current screen policy.
 */
export async function getScreenConfig(): Promise<IUntrustedScreenConfig> {
    return parse<IUntrustedScreenConfig>(await fetch(`${BASE}/screen-config`), 'load screen config');
}

/**
 * Apply a partial update to the untrusted-content output screen policy and return
 * the full effective config the backend validated and stored. Sending only the
 * changed field keeps each control's save independent — a bad value 400s without
 * disturbing the others.
 *
 * @param patch - The subset of fields to change.
 * @returns The full effective config after the update.
 */
export async function setScreenConfig(patch: Partial<IUntrustedScreenConfig>): Promise<IUntrustedScreenConfig> {
    return parse<IUntrustedScreenConfig>(await fetch(`${BASE}/screen-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
    }), 'save screen config');
}

/**
 * List admin-defined user groups, for the audience editor's group picker. Reads
 * the identity module's admin endpoint (a different base than the AI-tools
 * routes); same-origin so the admin session cookie authorizes it.
 *
 * @returns The defined user groups.
 */
export async function listUserGroups(): Promise<IUserGroup[]> {
    const data = await parse<{ groups: IUserGroup[] }>(await fetch('/api/admin/users/groups'), 'load user groups');
    return data.groups;
}
