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
    AiToolSensitivity,
    ICurationPreview,
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
    IStaticPromptVariableInput,
    IStaticPromptVariableUpdate,
    ISavedPrompt,
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
    limit?: number;
    offset?: number;
}

/**
 * One held item in the central curation queue, as returned by `GET /curations`.
 * Mirrors the backend's serialized envelope (dates as ISO strings); `preview` is
 * the content-agnostic descriptor the queue renders, and `ref` is the owning
 * type's opaque pointer (used by an inline editor to address its own record).
 */
export interface ICurationItemView {
    id: string;
    typeId: string;
    providerId: string;
    ref: Record<string, unknown>;
    preview: ICurationPreview;
    status: string;
    source?: string;
    createdAt: string;
    decidedAt?: string;
    decidedBy?: string;
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
 * List pending items in the central curation queue, newest first.
 *
 * @returns The pending curation envelopes.
 */
export async function listCurations(): Promise<ICurationItemView[]> {
    const data = await parse<{ curations: ICurationItemView[] }>(await fetch(`${BASE}/curations`), 'load curation queue');
    return data.curations;
}

/**
 * Fetch the count of pending curation items, for the header badge.
 *
 * @returns The pending count.
 */
export async function getCurationsCount(): Promise<number> {
    const data = await parse<{ count: number }>(await fetch(`${BASE}/curations/count`), 'load curation count');
    return data.count;
}

/**
 * Apply an inline edit to a held curation item before deciding it. The patch is
 * generic (today just `body`); the owning type maps it onto its record and
 * validates it, so a rejected edit surfaces as a thrown error here.
 *
 * @param id - The curation envelope id.
 * @param patch - The generic edit (e.g. replacement body text).
 * @returns Resolves when the edit is applied.
 */
export async function editCuration(id: string, patch: { body: string }): Promise<void> {
    await parse(await fetch(`${BASE}/curations/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
    }), 'edit curation item');
}

/**
 * Approve a held curation item, committing it through its owning type.
 *
 * @param id - The curation envelope id.
 * @returns Resolves when the item resolves.
 */
export async function approveCuration(id: string): Promise<void> {
    await parse(await fetch(`${BASE}/curations/${encodeURIComponent(id)}/approve`, { method: 'POST' }), 'approve curation item');
}

/**
 * Reject a held curation item, discarding it through its owning type.
 *
 * @param id - The curation envelope id.
 * @returns Resolves when the item resolves.
 */
export async function rejectCuration(id: string): Promise<void> {
    await parse(await fetch(`${BASE}/curations/${encodeURIComponent(id)}/reject`, { method: 'POST' }), 'reject curation item');
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
 */
export interface IQueryRequest {
    prompt: string;
    queryId?: string;
    socketId?: string;
    model?: string;
    stream?: boolean;
    messages?: IAiConversationMessage[];
    conversationId?: string;
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

/** Body for {@link saveSavedPrompt}. Omit `id` to create; supply it to update. */
export interface ISavePromptRequest {
    id?: string;
    name?: string;
    prompt?: string;
    /** Cron expression; `''`/`null` clears the schedule. Omit to leave unchanged. */
    cron?: string | null;
    scheduleEnabled?: boolean;
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
