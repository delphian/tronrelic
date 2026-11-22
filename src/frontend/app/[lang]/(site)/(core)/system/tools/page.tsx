/**
 * @fileoverview /system/tools server entry.
 *
 * Reads the page's tab row and the Bootstrap tab's rows with the admin's
 * session cookie, so the page renders with real data on first paint, and hands
 * both to the client shell. Admin-gated by the /system layout.
 */

import { cookies } from 'next/headers';
import type { IToolsBootstrapPage } from '@/types';
import { TOOLS_ADMIN_SUBMENU_NAMESPACE } from '@/types';
import { getServerSideApiUrl } from '../../../../../../lib/api-url';
import { fetchMenuNamespace } from '../../../../../../modules/menu/server';
import { ToolsAdminClient } from '../../../../../../modules/tools';

/**
 * Read the bootstrap rows as the signed-in admin.
 *
 * @param cookieHeader - The request's cookies, which carry the admin session.
 * @returns The rows, or null when the backend could not be read, which the
 *   tab shows as a load failure rather than as an empty list.
 */
async function fetchBootstrapPages(cookieHeader: string): Promise<IToolsBootstrapPage[] | null> {
    let pages: IToolsBootstrapPage[] | null = null;
    try {
        const response = await fetch(`${getServerSideApiUrl()}/api/admin/tools/bootstrap`, {
            // Admin-only and changes on every create, so never cached.
            cache: 'no-store',
            headers: cookieHeader ? { Cookie: cookieHeader } : undefined
        });
        if (response.ok) {
            pages = (await response.json() as { pages: IToolsBootstrapPage[] }).pages;
        } else {
            console.error('Failed to fetch tools bootstrap pages:', response.status, response.statusText);
        }
    } catch (error) {
        console.error('Error fetching tools bootstrap pages:', error);
    }

    return pages;
}

/**
 * Tools admin page (server entry).
 *
 * @param props - Next.js route props.
 * @param props.searchParams - The `?tab=` deep link, read here so a refreshed
 *   or shared link opens on the selected tab.
 * @returns The client shell seeded with the tab row and bootstrap rows.
 */
export default async function ToolsAdminPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
    const cookieHeader = (await cookies()).toString();
    const [submenu, bootstrapPages, { tab }] = await Promise.all([
        fetchMenuNamespace(TOOLS_ADMIN_SUBMENU_NAMESPACE, cookieHeader),
        fetchBootstrapPages(cookieHeader),
        searchParams
    ]);

    return (
        <ToolsAdminClient
            submenuTree={submenu.roots}
            submenuGeneratedAt={submenu.generatedAt}
            initialBootstrapPages={bootstrapPages}
            initialTab={tab}
        />
    );
}
