'use client';

/**
 * @fileoverview Client shell for /system/address-tags.
 *
 * Holds the in-page tab row and the three tab panels: the tag management
 * table, the ingestion source status panel, and the ingestion settings form.
 * The tab row is the menu module's Submenu Pattern — a namespaced menu
 * rendered with `MenuNavClient`, not a hand-rolled button array — so it
 * inherits per-user gating, ordering, and live `menu:update` refresh. The
 * server entry (`page.tsx`) fetches that namespace tree SSR-first and passes
 * it in. Clicking a tab drives local state via `onItemSelect` rather than
 * navigating; `activeUrl` highlights the active tab since the route is
 * identical across them.
 */

import { useCallback, useState } from 'react';
import type { MenuNodeSerialized } from '@/shared';
import { Page, PageHeader } from '../../../../components/layout';
import { MenuNavClient } from '../../../../components/layout/MenuNav/MenuNavClient';
import { AddressTagsManager } from './AddressTagsManager';
import { SourcesTab } from './SourcesTab';
import { SettingsTab } from './SettingsTab';
import styles from './page.module.scss';

/** The page's three tab ids; the `?tab=` value carried by each submenu node. */
type TabId = 'tags' | 'sources' | 'settings';

/** The menu namespace the module registers the tab nodes under. */
const SUBMENU_NAMESPACE = 'address-tags';

/**
 * Type guard narrowing an arbitrary `?tab=` string to a known TabId, so the
 * deep-link seeding and click routing share one source of truth for valid tabs.
 *
 * @param tab - The raw `?tab=` value.
 * @returns True when the value names a real tab.
 */
function isTabId(tab: string | undefined): tab is TabId {
    return tab === 'tags' || tab === 'sources' || tab === 'settings';
}

/**
 * Resolve a submenu node's `?tab=` value to a known TabId, defaulting to
 * `tags` for an unrecognized or missing value so a malformed node can never
 * leave the page on a blank panel.
 *
 * @param url - The clicked node's url (e.g. `/system/address-tags?tab=sources`).
 * @returns The matching tab id.
 */
function tabFromUrl(url: string | undefined): TabId {
    const tab = url?.match(/[?&]tab=([^&]+)/)?.[1];
    return isTabId(tab) ? tab : 'tags';
}

/**
 * Props for the client shell.
 */
interface IAddressTagsAdminClientProps {
    /** SSR-fetched submenu nodes (the tab row), already gated for the admin. */
    submenuTree: MenuNodeSerialized[];
    /** Snapshot timestamp of the submenu tree, seeded onto the menu Redux slice. */
    submenuGeneratedAt: string;
    /**
     * The `?tab=` value from the request URL, read SSR-first in `page.tsx` so a
     * refreshed, bookmarked, or shared deep link opens on the right panel. An
     * unknown or absent value resolves to `tags`.
     */
    initialTab?: string;
}

/**
 * Address-tags admin client shell: header, tab row, and the active panel.
 *
 * @param props - SSR submenu tree, its timestamp, and the deep-linked initial tab.
 * @returns The page.
 */
export function AddressTagsAdminClient({ submenuTree, submenuGeneratedAt, initialTab }: IAddressTagsAdminClientProps) {
    const [activeTab, setActiveTab] = useState<TabId>(isTabId(initialTab) ? initialTab : 'tags');

    /**
     * Activate the clicked tab and keep its URL a real deep link.
     *
     * `MenuNavClient` suppresses the <Link> navigation when `onItemSelect` is
     * set, so without this the address bar would never reflect the selected tab
     * and a refresh, bookmark, or shared link would fall back to the Tags
     * panel. Rewriting the address in place with `history.replaceState` needs
     * no server round-trip and no `useSearchParams` Suspense boundary;
     * `page.tsx` reads the value SSR-first to seed the panel on next load.
     *
     * @param item - The clicked submenu node, carrying its `?tab=` url.
     */
    const handleTabSelect = useCallback((item: MenuNodeSerialized) => {
        const tab = tabFromUrl(item.url);
        setActiveTab(tab);
        window.history.replaceState(null, '', `/system/address-tags?tab=${tab}`);
    }, []);

    return (
        <Page>
            <PageHeader
                title="Address Tags"
                subtitle="Create, rename, and remove text tags attached to TRON wallet addresses, and manage the machine sources that assert sanctions and freeze tags."
            />

            <div className={styles.submenu}>
                <MenuNavClient
                    namespace={SUBMENU_NAMESPACE}
                    items={submenuTree}
                    generatedAt={submenuGeneratedAt}
                    ariaLabel="Address tags sections"
                    activeUrl={`/system/address-tags?tab=${activeTab}`}
                    onItemSelect={handleTabSelect}
                />
            </div>

            <div className={styles.content}>
                {activeTab === 'tags' && <AddressTagsManager />}
                {activeTab === 'sources' && <SourcesTab />}
                {activeTab === 'settings' && <SettingsTab />}
            </div>
        </Page>
    );
}
