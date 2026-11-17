/**
 * @fileoverview API client for the MCP admin page (`/api/admin/mcp`).
 *
 * Same-origin fetches, so the admin's Better Auth session cookie rides along
 * and the backend's admin gate applies. Every function throws with the
 * backend's message on a non-2xx response so the page can toast the reason.
 */

import type {
    IConnectedAppListPage,
    IMcpGroupPolicy,
    IMcpGroupPolicyPatch,
    IMcpSettings,
    IMcpStatus,
    IMcpToolExposure,
    IMcpUsageGroupDetail,
    IMcpUsageReport,
    McpUsageWindow
} from '@/types';

const BASE = '/api/admin/mcp';

/**
 * Connected apps shown per page on the admin page, both during server
 * rendering and for each page or search after it. Small enough that a page
 * fits a few screens at phone width, where every grant is a stacked entry;
 * an admin looking for one person's apps searches by email instead of paging.
 */
export const MCP_APPS_PAGE_SIZE = 25;

/**
 * Unwrap a response or raise its error message.
 *
 * @param response - The fetch response to check.
 * @param what - Verb phrase naming the action, for the fallback message.
 * @returns The parsed JSON body.
 * @throws When the response is not ok.
 */
async function parse<T>(response: Response, what: string): Promise<T> {
    if (!response.ok) {
        const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(body.error_description || body.error || `Failed to ${what} (HTTP ${response.status})`);
    }
    return response.json() as Promise<T>;
}

/**
 * Read the overview: kill switch, URLs, member and tool counts.
 *
 * @returns The current status.
 */
export async function getMcpStatus(): Promise<IMcpStatus> {
    const body = await parse<{ status: IMcpStatus }>(await fetch(`${BASE}/status`, { cache: 'no-store' }), 'load MCP status');
    return body.status;
}

/**
 * Turn the MCP endpoint on or off.
 *
 * @param enabled - The new kill switch state.
 * @returns The stored settings.
 */
export async function setMcpEnabled(enabled: boolean): Promise<IMcpSettings> {
    const body = await parse<{ settings: IMcpSettings }>(await fetch(`${BASE}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
    }), enabled ? 'enable the MCP endpoint' : 'disable the MCP endpoint');
    return body.settings;
}

/**
 * List every registered tool with its MCP state.
 *
 * @returns The tool rows, sorted by owning module or plugin and then by name.
 */
export async function listMcpTools(): Promise<IMcpToolExposure[]> {
    const body = await parse<{ tools: IMcpToolExposure[] }>(await fetch(`${BASE}/tools`, { cache: 'no-store' }), 'load MCP tools');
    return body.tools;
}

/**
 * Approve or withdraw one tool for one user group.
 *
 * @param name - Registered tool name.
 * @param groupId - The group the approval is for.
 * @param exposed - True to approve, false to withdraw.
 * @returns The updated row, or null when a withdrawn tool is no longer
 *   registered (its approval was removed, but it has no row any more).
 */
export async function setMcpToolExposure(name: string, groupId: string, exposed: boolean): Promise<IMcpToolExposure | null> {
    const body = await parse<{ tool: IMcpToolExposure | null }>(await fetch(`${BASE}/tools/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exposed, groupId })
    }), exposed ? 'expose the tool' : 'withdraw the tool');
    return body.tool;
}

/**
 * Change one group's MCP settings.
 *
 * @param groupId - The group to change.
 * @param change - The settings to change.
 * @returns The stored policy, and how many restricted tools were withdrawn
 *   because "allow restricted tools" was switched off.
 */
export async function updateMcpGroupPolicy(groupId: string, change: IMcpGroupPolicyPatch):Promise<{ policy: IMcpGroupPolicy; withdrawnRestrictedGrants: number }> {
    return parse(await fetch(`${BASE}/groups/${encodeURIComponent(groupId)}/policy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(change)
    }), 'update the group settings');
}

/**
 * Read endpoint totals and one line per group over a window, the top level of
 * the usage view.
 *
 * @param window - How far back to look.
 * @returns The usage report.
 */
export async function getMcpUsage(window: McpUsageWindow): Promise<IMcpUsageReport> {
    const body = await parse<{ usage: IMcpUsageReport }>(await fetch(`${BASE}/usage?window=${window}`, { cache: 'no-store' }), 'load MCP usage');
    return body.usage;
}

/**
 * Read one group's tools and busiest callers over a window, the second level
 * of the usage view.
 *
 * @param groupId - The group to open.
 * @param window - How far back to look.
 * @param toolName - When set, the callers list counts only this tool's calls.
 * @returns The group's usage detail.
 */
export async function getMcpUsageGroupDetail(groupId: string, window: McpUsageWindow, toolName: string | null): Promise<IMcpUsageGroupDetail> {
    const tool = toolName ? `&tool=${encodeURIComponent(toolName)}` : '';
    const body = await parse<{ detail: IMcpUsageGroupDetail }>(
        await fetch(`${BASE}/usage/groups/${encodeURIComponent(groupId)}?window=${window}${tool}`, { cache: 'no-store' }),
        'load the group usage'
    );
    return body.detail;
}

/**
 * List connected apps across all users, one page at a time.
 *
 * @param limit - Page size.
 * @param offset - Rows to skip.
 * @param search - Text to find in the user's email or name; blank lists every grant.
 * @returns One page of grants, the total for the pager, and whether a broad
 *   search covered only some of the accounts it matched.
 */
export async function listMcpApps(limit: number, offset: number, search = ''): Promise<IConnectedAppListPage> {
    const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (search.trim()) {
        query.set('search', search.trim());
    }
    return parse(await fetch(`${BASE}/apps?${query.toString()}`, { cache: 'no-store' }), 'load connected apps');
}

/**
 * Revoke one user's grant to one app.
 *
 * @param userId - Better Auth user id.
 * @param clientId - OAuth client id.
 * @returns Resolves once revoked.
 */
export async function revokeMcpApp(userId: string, clientId: string): Promise<void> {
    const response = await fetch(`${BASE}/apps/${encodeURIComponent(userId)}?clientId=${encodeURIComponent(clientId)}`, { method: 'DELETE' });
    if (!response.ok) {
        await parse<unknown>(response, 'revoke the app');
    }
}
