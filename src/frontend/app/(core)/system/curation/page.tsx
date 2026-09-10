/**
 * @fileoverview /system/curation server entry — the central curation queue.
 *
 * Every effect held for human review across the platform — drafted tweets,
 * broadcast messages, generated images, any future reviewable content — is
 * decided here, rather than each plugin hosting its own approval UI.
 *
 * This server component fetches the page's in-page tab row (the `curation`
 * menu namespace, the menu module's Submenu Pattern) and reads the `?tab=` deep
 * link, then hands both to the client shell. It forwards the admin's session
 * cookie so each tab node's `requiresAdmin` gating resolves, the same way the
 * ai-tools and address-tags pages feed their tab rows. Admin-gated by the
 * /system layout.
 */

import { cookies } from 'next/headers';
import type { MenuNodeSerialized } from '@/shared';
import { getServerSideApiUrl } from '../../../../lib/api-url';
import { CurationAdminClient } from './CurationAdminClient';

/** Namespace holding the page's tab nodes; registered by CurationModule. */
const SUBMENU_NAMESPACE = 'curation';

/**
 * Fetch the submenu namespace tree from the menu API, forwarding the visitor's
 * cookies so the backend's per-user `requiresAdmin` gating resolves for the
 * admin. Any failure yields an empty tree, mirroring `MenuNavSSR`: the page
 * still renders, just without the tab row until a live `menu:update` refetch
 * repopulates it.
 *
 * @returns The namespace root nodes and the tree snapshot timestamp.
 */
async function fetchSubmenu(): Promise<{ roots: MenuNodeSerialized[]; generatedAt: string }> {
    const fallback = { roots: [] as MenuNodeSerialized[], generatedAt: new Date().toISOString() };
    let result = fallback;
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
                generatedAt: data.tree?.generatedAt ?? fallback.generatedAt
            };
        }
    } catch {
        result = fallback;
    }
    return result;
}

/**
 * Curation queue page (server entry).
 *
 * @param props - Next.js route props.
 * @param props.searchParams - The `?tab=` deep link (a Promise in Next.js 15+),
 *   read on the server so a refreshed or shared link opens on the same tab.
 * @returns The client shell seeded with the tab row and the initial tab.
 */
export default async function CurationAdminPage({
    searchParams
}: {
    searchParams: Promise<{ tab?: string }>;
}) {
    const { roots, generatedAt } = await fetchSubmenu();
    const { tab } = await searchParams;
    return (
        <CurationAdminClient
            submenuTree={roots}
            submenuGeneratedAt={generatedAt}
            initialTab={tab}
        />
    );
}
