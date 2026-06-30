/**
 * @fileoverview /system/account-history server entry.
 *
 * Fetches the page's in-page tab row from the menu service SSR-first and hands
 * it to the client shell. The tab row is a namespaced menu (menu module's
 * Submenu Pattern), not a hand-rolled button array, so it inherits per-user
 * gating, ordering, and live `menu:update` refresh. This server component
 * fetches that namespace tree once — forwarding the admin's session cookie so
 * the nodes' `requiresAdmin` gating resolves — exactly as `MenuNavSSR` feeds the
 * global nav; the client shell then renders it with `MenuNavClient` and drives
 * the active panel. Admin-gated by the /system layout.
 */

import { cookies } from 'next/headers';
import type { MenuNodeSerialized } from '@/shared';
import { getServerSideApiUrl } from '../../../../lib/api-url';
import { AccountHistoryAdminClient } from './AccountHistoryAdminClient';

/** Namespace holding the page's tab nodes; registered by AccountHistoryModule. */
const SUBMENU_NAMESPACE = 'account-history';

/**
 * Fetch the submenu namespace tree from the menu API, forwarding the visitor's
 * cookies so the backend's per-user `requiresAdmin` gating resolves for the
 * admin. On any failure it returns an empty tree, mirroring `MenuNavSSR`'s
 * graceful degradation — the page still renders, just without the tab row until
 * a live `menu:update` refetch repopulates it.
 *
 * @returns The namespace root nodes and the tree snapshot timestamp.
 */
async function fetchSubmenu(): Promise<{ roots: MenuNodeSerialized[]; generatedAt: string }> {
    const fallback = { roots: [] as MenuNodeSerialized[], generatedAt: new Date().toISOString() };
    try {
        const cookieHeader = (await cookies()).toString();
        const response = await fetch(`${getServerSideApiUrl()}/api/menu?namespace=${SUBMENU_NAMESPACE}`, {
            cache: 'no-store',
            headers: cookieHeader ? { Cookie: cookieHeader } : undefined
        });
        if (!response.ok) {
            return fallback;
        }
        const data = await response.json() as { tree?: { roots?: MenuNodeSerialized[]; generatedAt?: string } };
        return {
            roots: data.tree?.roots ?? [],
            generatedAt: data.tree?.generatedAt ?? fallback.generatedAt
        };
    } catch {
        return fallback;
    }
}

/**
 * Account-history admin page (server entry).
 *
 * @returns The client shell seeded with the SSR-fetched submenu tree.
 */
export default async function AccountHistoryAdminPage() {
    const { roots, generatedAt } = await fetchSubmenu();
    return <AccountHistoryAdminClient submenuTree={roots} submenuGeneratedAt={generatedAt} />;
}
