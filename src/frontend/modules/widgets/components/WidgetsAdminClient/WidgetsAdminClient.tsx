'use client';

/**
 * @fileoverview Client shell for /system/widgets.
 *
 * Holds the in-page tab row and its two panels: the placement editor and
 * this module's MongoDB storage. The tab row is the menu module's Submenu
 * Pattern, a namespaced menu rendered with `MenuNavClient`, so it inherits
 * per-user gating, ordering, live `menu:update` refresh, and lets a plugin
 * contribute a tab later. The server entry fetches that namespace tree and
 * the editor's data SSR-first and passes both in, so the first paint shows
 * real zones and rows rather than a loading message.
 *
 * @module modules/widgets/components/WidgetsAdminClient
 */

import { useCallback, useState } from 'react';
import type { MenuNodeSerialized } from '@/shared';
import { Page } from '../../../../components/layout';
import { MenuNavClient } from '../../../../components/layout/MenuNav/MenuNavClient';
import { CollectionBrowser } from '../../../database';
import type { IWidgetsAdminData } from '../../types/IWidgetsAdminData';
import { PlacementsWorkbench } from '../PlacementsWorkbench';
import styles from './WidgetsAdminClient.module.scss';

/** The page's tab ids; the `?tab=` value carried by each submenu node. */
type TabId = 'placements' | 'database';

/** The menu namespace the widgets module registers the tab nodes under. */
const SUBMENU_NAMESPACE = 'widgets';

/**
 * Physical MongoDB collection prefix covering everything the widgets
 * module owns: placements and zone layout overrides. Scoping the browser
 * to it keeps the panel on this module's data. The module's key-value
 * entries live in the shared `_kv` collection, outside this prefix, and
 * stay reachable from `/system/database`.
 */
const COLLECTION_PREFIX = 'module_widgets_';

/**
 * Narrow an arbitrary `?tab=` value to a known tab.
 *
 * @param tab - The raw value.
 * @returns True when it names a real tab.
 */
function isTabId(tab: string | undefined): tab is TabId {
    return tab === 'placements' || tab === 'database';
}

/**
 * Resolve a submenu node's url to a tab, defaulting to the editor.
 *
 * @param url - The clicked node's url.
 * @returns The tab id.
 */
function tabFromUrl(url: string | undefined): TabId {
    const tab = url?.match(/[?&]tab=([^&]+)/)?.[1];
    return isTabId(tab) ? tab : 'placements';
}

/**
 * Props for the shell.
 */
export interface IWidgetsAdminClientProps {
    /** SSR-fetched submenu nodes, already gated for the admin. */
    submenuTree: MenuNodeSerialized[];
    /** Snapshot timestamp of the submenu tree. */
    submenuGeneratedAt: string;
    /** The `?tab=` value from the request URL, read SSR-first. */
    initialTab?: string;
    /** The editor's seed data. */
    data: IWidgetsAdminData;
}

/**
 * Widgets admin shell: tab row and the active panel.
 *
 * @param props - See {@link IWidgetsAdminClientProps}.
 * @returns The page.
 */
export function WidgetsAdminClient({ submenuTree, submenuGeneratedAt, initialTab, data }: IWidgetsAdminClientProps) {
    const [activeTab, setActiveTab] = useState<TabId>(isTabId(initialTab) ? initialTab : 'placements');

    /**
     * Activate the clicked tab and keep its URL a real deep link, so a
     * refresh or a shared link opens on the same panel.
     *
     * @param item - The clicked submenu node.
     */
    const handleTabSelect = useCallback((item: MenuNodeSerialized) => {
        const tab = tabFromUrl(item.url);
        setActiveTab(tab);
        window.history.replaceState(null, '', `/system/widgets?tab=${tab}`);
    }, []);

    return (
        <Page>
            <div className={styles.submenu}>
                <MenuNavClient
                    namespace={SUBMENU_NAMESPACE}
                    items={submenuTree}
                    generatedAt={submenuGeneratedAt}
                    ariaLabel="Widgets sections"
                    activeUrl={`/system/widgets?tab=${activeTab}`}
                    onItemSelect={handleTabSelect}
                />
            </div>

            <div>
                {/* Hidden rather than unmounted while another tab is open. The
                    workbench seeds its state once from the server snapshot, so
                    unmounting it would discard every placement added, moved, or
                    removed during this visit and drop its live-update listener,
                    and returning to the tab would show the original snapshot
                    again. The collection browser loads on mount, so it stays
                    conditional and does no work in the background. */}
                <div hidden={activeTab !== 'placements'}>
                    <PlacementsWorkbench initial={data} />
                </div>
                {activeTab === 'database' && (
                    <CollectionBrowser prefix={COLLECTION_PREFIX} title="Widget Collections" />
                )}
            </div>
        </Page>
    );
}
