'use client';

/**
 * @fileoverview Client shell for /system/system.
 *
 * Hosts the in-page tab row (the menu module's Submenu Pattern — a namespaced
 * menu rendered with `MenuNavClient`, not a hand-rolled control) and the tab
 * panels. The server entry fetches the `system` namespace tree SSR-first and
 * passes it in; clicking a tab drives local state via `onItemSelect` rather than
 * navigating, and `activeUrl` highlights the active tab since the route is
 * identical across them. "Overview" carries the subsystem consoles; "Providers"
 * hosts external-provider configuration.
 */

import { useState, useCallback } from 'react';
import type { MenuNodeSerialized } from '@/shared';
import { Page, PageHeader } from '../../../../components/layout';
import { MenuNavClient } from '../../../../components/layout/MenuNav/MenuNavClient';
import { OverviewTab } from './components/OverviewTab';
import { ProvidersTab } from './components/ProvidersTab';
import styles from './page.module.scss';

/** The page's tab ids; the `?tab=` value carried by each submenu node. */
type TabId = 'overview' | 'providers';

/** The menu namespace the tab nodes are registered under. */
const SUBMENU_NAMESPACE = 'system';

/**
 * Props for the client shell.
 */
interface ISystemAdminClientProps {
    /** SSR-fetched submenu nodes (the tab row), already gated for the admin. */
    submenuTree: MenuNodeSerialized[];
    /** Snapshot timestamp of the submenu tree, seeded onto the menu Redux slice. */
    submenuGeneratedAt: string;
    /** The `?tab=` value from the request URL; unknown/absent resolves to `overview`. */
    initialTab?: string;
}

/**
 * Resolve a node's `?tab=` value to a known TabId, defaulting to `overview`.
 *
 * @param url - The clicked node's url (e.g. `/system/system?tab=providers`).
 * @returns The matching tab id.
 */
function tabFromUrl(url: string | undefined): TabId {
    const tab = url?.match(/[?&]tab=([^&]+)/)?.[1];
    return tab === 'providers' ? 'providers' : 'overview';
}

/**
 * System admin client shell.
 *
 * @param props - SSR submenu tree, its timestamp, and the deep-linked initial tab.
 * @returns The page.
 */
export function SystemAdminClient({ submenuTree, submenuGeneratedAt, initialTab }: ISystemAdminClientProps) {
    const [activeTab, setActiveTab] = useState<TabId>(initialTab === 'providers' ? 'providers' : 'overview');

    /**
     * Activate the clicked tab and keep its URL a real deep link.
     *
     * `MenuNavClient` suppresses the <Link> navigation when `onItemSelect` is set,
     * so rewrite the address in place with `history.replaceState` — no server
     * round-trip — so the `?tab=` URLs become true deep links the server entry can
     * read SSR-first on next load.
     *
     * @param item - The clicked submenu node, carrying its `?tab=` url.
     */
    const handleTabSelect = useCallback((item: MenuNodeSerialized) => {
        const tab = tabFromUrl(item.url);
        setActiveTab(tab);
        window.history.replaceState(null, '', `/system/system?tab=${tab}`);
    }, []);

    return (
        <Page>
            <PageHeader
                title="System"
                subtitle="Live status across every subsystem, plus runtime configuration for external data providers."
            />

            <div className={styles.submenu}>
                <MenuNavClient
                    namespace={SUBMENU_NAMESPACE}
                    items={submenuTree}
                    generatedAt={submenuGeneratedAt}
                    ariaLabel="System sections"
                    activeUrl={`/system/system?tab=${activeTab}`}
                    onItemSelect={handleTabSelect}
                />
            </div>

            <div className={styles.content}>
                {activeTab === 'overview' && <OverviewTab />}
                {activeTab === 'providers' && <ProvidersTab />}
            </div>
        </Page>
    );
}
