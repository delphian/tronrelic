/**
 * @fileoverview /system/system server entry.
 *
 * The consolidated System page now carries an in-page tab row (the menu module's
 * Submenu Pattern) so it can host distinct concerns — the subsystem consoles
 * under "Overview" and external-provider config under "Providers" — without a
 * hand-rolled control. This server component fetches the `system` namespace tree
 * SSR-first (forwarding the admin's cookie so per-node `requiresAdmin` resolves)
 * and reads `?tab=` to seed the active panel, mirroring /system/account-history.
 * Admin-gated by the /system layout.
 */

import { cookies } from 'next/headers';
import type { MenuNodeSerialized } from '@/shared';
import { getServerSideApiUrl } from '../../../../lib/api-url';
import { SystemAdminClient } from './SystemAdminClient';

/** Namespace holding the page's tab nodes; registered in bootstrap. */
const SUBMENU_NAMESPACE = 'system';

/**
 * Fetch the submenu namespace tree, forwarding cookies so the admin gating
 * resolves. Degrades to an empty tree on any failure — the page still renders,
 * just without the tab row until a live `menu:update` refetch repopulates it.
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
 * System admin page (server entry).
 *
 * @param props - Next.js route props.
 * @param props.searchParams - The `?tab=` deep link (a Promise in Next.js 15+),
 *   read SSR-first to seed the initially active panel.
 * @returns The client shell seeded with the SSR-fetched submenu tree.
 */
export default async function SystemAdminPage({
    searchParams
}: {
    searchParams: Promise<{ tab?: string }>;
}) {
    const { roots, generatedAt } = await fetchSubmenu();
    const { tab } = await searchParams;
    return <SystemAdminClient submenuTree={roots} submenuGeneratedAt={generatedAt} initialTab={tab} />;
}
