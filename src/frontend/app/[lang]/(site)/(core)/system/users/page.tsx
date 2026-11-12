/**
 * @fileoverview /system/users server entry.
 *
 * Fetches the page's in-page tab row from the menu service on the server and
 * hands it to the client shell. The tab row is a namespaced menu (menu
 * module's Submenu Pattern), not a hand-written button row, so it inherits
 * per-user gating, ordering, and live `menu:update` refresh, and a plugin can
 * add a tab. The admin's session cookie is forwarded so the nodes'
 * `requiresAdmin` gating resolves. Admin-gated by the /system layout.
 */

import { cookies } from 'next/headers';
import type { MenuNodeSerialized } from '@/shared';
import { getServerSideApiUrl } from '../../../../../../lib/api-url';
import { UsersAdminClient } from './UsersAdminClient';

/** Namespace holding the page's tab nodes; registered by IdentityModule. */
const SUBMENU_NAMESPACE = 'identity';

/**
 * Fetch the submenu namespace tree from the menu API, forwarding the visitor's
 * cookies so the backend's per-user `requiresAdmin` gating resolves for the
 * admin. On any failure it returns an empty tree, so the page still renders
 * and the tab row appears once a live `menu:update` refetch repopulates it.
 *
 * @returns The namespace root nodes and the tree snapshot timestamp.
 */
async function fetchSubmenu(): Promise<{ roots: MenuNodeSerialized[]; generatedAt: string }> {
    let result = { roots: [] as MenuNodeSerialized[], generatedAt: new Date().toISOString() };
    try {
        const cookieHeader = (await cookies()).toString();
        const response = await fetch(`${getServerSideApiUrl()}/api/menu?namespace=${SUBMENU_NAMESPACE}`, {
            cache: 'no-store',
            headers: cookieHeader ? { Cookie: cookieHeader } : undefined
        });
        if (response.ok) {
            const data = await response.json() as { tree?: { roots?: MenuNodeSerialized[]; generatedAt?: string } };
            result = {
                roots: data.tree?.roots ?? [],
                generatedAt: data.tree?.generatedAt ?? result.generatedAt
            };
        }
    } catch {
        // Keep the empty tree; the client refetches on the next menu update.
    }
    return result;
}

/**
 * Users admin page (server entry).
 *
 * @param props - Next.js route props.
 * @param props.searchParams - The `?tab=` deep link (a Promise in Next.js 15+),
 *   read on the server so a refreshed, bookmarked, or shared link opens on the
 *   selected tab.
 * @returns The client shell seeded with the server-fetched submenu tree.
 */
export default async function SystemUsersPage({
    searchParams
}: {
    searchParams: Promise<{ tab?: string }>;
}) {
    const { roots, generatedAt } = await fetchSubmenu();
    const { tab } = await searchParams;
    return <UsersAdminClient submenuTree={roots} submenuGeneratedAt={generatedAt} initialTab={tab} />;
}
