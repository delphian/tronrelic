/**
 * @fileoverview /system/mcp server entry.
 *
 * Fetches everything the page's primary panels show — the tab row, the
 * endpoint status behind the kill switch, the tool list with its per-group
 * grants, the user groups with their MCP settings, and the first page of
 * connected apps — during server rendering, forwarding the
 * admin's session cookie, so the page paints with real data and the kill
 * switch shows its true state on first paint. Admin-gated by the /system
 * layout.
 */

import { cookies } from 'next/headers';
import type { MenuNodeSerialized } from '@/shared';
import type { IConnectedAppAdminRow, IMcpGroup, IMcpStatus, IMcpToolExposure } from '@/types';
import { getServerSideApiUrl } from '../../../../lib/api-url';
import { MCP_APPS_PAGE_SIZE } from '../../../../modules/mcp';
import { McpAdminClient } from './McpAdminClient';

/** Namespace holding the page's tab nodes; registered by the MCP module. */
const SUBMENU_NAMESPACE = 'mcp';

/**
 * GET a backend JSON endpoint with the admin's cookies, returning null on any
 * failure so one broken panel does not blank the whole page.
 *
 * @param path - Backend path starting with `/api/`.
 * @returns The parsed body, or null.
 */
async function fetchAdminJson<T>(path: string): Promise<T | null> {
    let body: T | null = null;
    try {
        const cookieHeader = (await cookies()).toString();
        const response = await fetch(`${getServerSideApiUrl()}${path}`, {
            cache: 'no-store',
            headers: cookieHeader ? { Cookie: cookieHeader } : undefined
        });
        body = response.ok ? await response.json() as T : null;
    } catch {
        body = null;
    }
    return body;
}

/**
 * MCP admin page (server entry).
 *
 * @param props - Next.js route props.
 * @param props.searchParams - The `?tab=` deep link, read SSR-first to seed the active panel.
 * @returns The client shell seeded with SSR data.
 */
export default async function McpAdminPage({
    searchParams
}: {
    searchParams: Promise<{ tab?: string }>;
}) {
    const [menu, status, tools, groups, apps, { tab }] = await Promise.all([
        fetchAdminJson<{ tree?: { roots?: MenuNodeSerialized[]; generatedAt?: string } }>(`/api/menu?namespace=${SUBMENU_NAMESPACE}`),
        fetchAdminJson<{ status: IMcpStatus }>('/api/admin/mcp/status'),
        fetchAdminJson<{ tools: IMcpToolExposure[] }>('/api/admin/mcp/tools'),
        fetchAdminJson<{ groups: IMcpGroup[] }>('/api/admin/mcp/groups'),
        fetchAdminJson<{ apps: IConnectedAppAdminRow[]; total: number }>(`/api/admin/mcp/apps?limit=${MCP_APPS_PAGE_SIZE}&offset=0`),
        searchParams
    ]);

    return (
        <McpAdminClient
            submenuTree={menu?.tree?.roots ?? []}
            submenuGeneratedAt={menu?.tree?.generatedAt ?? new Date().toISOString()}
            initialTab={tab}
            initialStatus={status?.status ?? null}
            initialTools={tools?.tools ?? []}
            initialGroups={groups?.groups ?? []}
            initialApps={apps?.apps ?? []}
            initialAppsTotal={apps?.total ?? 0}
        />
    );
}
