/**
 * @fileoverview API client for the MCP admin page (`/api/admin/mcp`).
 *
 * Same-origin fetches, so the admin's Better Auth session cookie rides along
 * and the backend's admin gate applies. Every function throws with the
 * backend's message on a non-2xx response so the page can toast the reason.
 */

import type { IConnectedAppAdminRow, IMcpSettings, IMcpStatus, IMcpToolExposure } from '@/types';

const BASE = '/api/admin/mcp';

/**
 * Connected apps fetched per page on the admin page, both during server
 * rendering and for each "Show more" click. Matches the backend's largest
 * allowed page, so the fewest round trips reach every grant.
 */
export const MCP_APPS_PAGE_SIZE = 200;

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
 * Approve or withdraw one tool for MCP.
 *
 * @param name - Registered tool name.
 * @param exposed - True to approve, false to withdraw.
 * @returns The updated row, or null when a withdrawn tool is no longer
 *   registered (its approval was removed, but it has no row any more).
 */
export async function setMcpToolExposure(name: string, exposed: boolean): Promise<IMcpToolExposure | null> {
    const body = await parse<{ tool: IMcpToolExposure | null }>(await fetch(`${BASE}/tools/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exposed })
    }), exposed ? 'expose the tool' : 'withdraw the tool');
    return body.tool;
}

/**
 * List connected apps across all users.
 *
 * @param limit - Page size.
 * @param offset - Rows to skip.
 * @returns One page of grants and the total.
 */
export async function listMcpApps(limit: number, offset: number): Promise<{ apps: IConnectedAppAdminRow[]; total: number }> {
    return parse(await fetch(`${BASE}/apps?limit=${limit}&offset=${offset}`, { cache: 'no-store' }), 'load connected apps');
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
