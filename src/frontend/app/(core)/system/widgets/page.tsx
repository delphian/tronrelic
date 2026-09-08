/**
 * @fileoverview /system/widgets server entry.
 *
 * Fetches the page's tab row from the menu service and the placement
 * editor's data SSR-first, then hands both to the client shell. The tab
 * row is a namespaced menu (menu module's Submenu Pattern) rather than a
 * hand-rolled button array, so it inherits per-user gating, ordering, and
 * live `menu:update` refresh. Admin-gated by the /system layout.
 *
 * @module app/(core)/system/widgets/page
 */

import { cookies } from 'next/headers';
import { WidgetsAdminClient } from '../../../../modules/widgets';
import { fetchMenuNamespace, fetchWidgetsAdminData } from '../../../../modules/widgets/server';

/** Namespace holding the page's tab nodes; registered by WidgetsModule. */
const SUBMENU_NAMESPACE = 'widgets';

/**
 * Widgets admin page (server entry).
 *
 * @param props - Next.js route props.
 * @param props.searchParams - The `?tab=` deep link, read SSR-first so a
 *   refreshed or shared link opens on the selected tab.
 * @returns The client shell seeded with the SSR-fetched tab row and data.
 */
export default async function WidgetsAdminPage({
    searchParams
}: {
    searchParams: Promise<{ tab?: string }>;
}) {
    const cookieHeader = (await cookies()).toString();
    const [submenu, data, { tab }] = await Promise.all([
        fetchMenuNamespace(SUBMENU_NAMESPACE, cookieHeader),
        fetchWidgetsAdminData(),
        searchParams
    ]);
    return (
        <WidgetsAdminClient
            submenuTree={submenu.roots}
            submenuGeneratedAt={submenu.generatedAt}
            initialTab={tab}
            data={data}
        />
    );
}
