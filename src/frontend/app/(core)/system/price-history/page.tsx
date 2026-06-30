/**
 * @fileoverview /system/price-history server entry.
 *
 * Fetches the page's in-page tab row from the menu service SSR-first (forwarding
 * the admin's session cookie so the nodes' `requiresAdmin` gating resolves) and
 * hands it to the client shell, which renders it with `MenuNavClient` and drives
 * the active panel — the menu module's Submenu Pattern, not a hand-rolled button
 * row. Admin-gated by the /system layout.
 */

import { cookies } from 'next/headers';
import type { MenuNodeSerialized } from '@/shared';
import { getServerSideApiUrl } from '../../../../lib/api-url';
import { PriceHistoryAdminClient } from './PriceHistoryAdminClient';

/** Namespace holding the page's tab nodes; registered by PriceHistoryModule. */
const SUBMENU_NAMESPACE = 'price-history';

/**
 * Fetch the page's submenu tree SSR-first, forwarding the session cookie.
 *
 * @returns The submenu roots and the tree's snapshot timestamp; an empty tree on
 *   any failure so the page still renders.
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
        const data = (await response.json()) as { tree?: { roots?: MenuNodeSerialized[]; generatedAt?: string } };
        return {
            roots: data.tree?.roots ?? [],
            generatedAt: data.tree?.generatedAt ?? fallback.generatedAt
        };
    } catch {
        return fallback;
    }
}

/**
 * Server entry: resolve the submenu and the deep-linked tab, then render the
 * client shell.
 *
 * @param props - Route props; `searchParams` carries the `?tab=` deep link.
 * @returns The admin client shell.
 */
export default async function PriceHistoryAdminPage({
    searchParams
}: {
    searchParams: Promise<{ tab?: string }>;
}) {
    const { roots, generatedAt } = await fetchSubmenu();
    const { tab } = await searchParams;
    return <PriceHistoryAdminClient submenuTree={roots} submenuGeneratedAt={generatedAt} initialTab={tab} />;
}
