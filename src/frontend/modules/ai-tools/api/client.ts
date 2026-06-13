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
    ITrifectaStatus,
    IToolInvocationRecord,
    IToolInvocationContext,
    IToolPolicy,
    IAiProviderInfo,
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

/** One page of invocation audit records plus the unpaginated total. */
export interface IActivityPage {
    items: IToolInvocationRecord[];
    total: number;
    limit: number;
    offset: number;
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

/** Per-tool policy overrides plus usage tallies, as returned by `GET /policy`. */
export interface IPolicyResponse {
    overrides: Record<string, IToolPolicy>;
    usage: Record<string, {
        invocations: number;
        allowed: number;
        denied: number;
        rateLimited: number;
        needsApproval: number;
    }>;
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
