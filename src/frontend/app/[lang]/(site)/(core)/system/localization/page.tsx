/**
 * @fileoverview /system/localization server entry.
 *
 * Fetches the page's in-page tab row from the menu service and hands it to the
 * client shell. The tab row is a namespaced menu (the menu module's Submenu
 * Pattern), so it inherits per-user gating, ordering, and live `menu:update`
 * refresh. The visitor's cookies are forwarded so the nodes' `requiresAdmin`
 * gate resolves for the admin. Admin-gated by the /system layout.
 */

import { cookies } from 'next/headers';
import { fetchMenuNamespace } from '../../../../../../modules/menu/server';
import { LocalizationAdminClient } from './LocalizationAdminClient';

/** Namespace holding the page's tab nodes; registered by LocalizationModule. */
const SUBMENU_NAMESPACE = 'localization';

/**
 * Localization admin page (server entry).
 *
 * @param props - Next.js route props.
 * @param props.searchParams - The `?tab=` deep link, read on the server so a
 *   refreshed or shared link opens on the selected tab.
 * @returns The client shell seeded with the tab row.
 */
export default async function LocalizationAdminPage({
    searchParams
}: {
    searchParams: Promise<{ tab?: string }>;
}) {
    const [{ roots, generatedAt }, { tab }] = await Promise.all([
        fetchMenuNamespace(SUBMENU_NAMESPACE, (await cookies()).toString()),
        searchParams
    ]);
    return <LocalizationAdminClient submenuTree={roots} submenuGeneratedAt={generatedAt} initialTab={tab} />;
}
