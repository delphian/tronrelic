/**
 * @fileoverview Client shell for `/system/tools`.
 *
 * Holds the tab row and the two panels: Bootstrap, where an admin creates the
 * CMS pages the tools module ships, and Logs, the core log monitor scoped to
 * this module. The module owns no collections and no scheduler jobs, so it has
 * no Database or Schedules tab. The tab row is the menu module's Submenu
 * Pattern: the server entry fetches the `tools-admin` namespace and this
 * shell renders it with `MenuNavClient`, driving the active panel from local
 * state and keeping `?tab=` in the address bar as a deep link.
 */
'use client';

import { useCallback, useState } from 'react';
import type { MenuNodeSerialized } from '@/shared';
import type { IToolsBootstrapPage } from '@/types';
import { TOOLS_ADMIN_SUBMENU_NAMESPACE } from '@/types';
import { AdminPage } from '../../../../components/layout';
import { MenuNavClient } from '../../../../components/layout/MenuNav/MenuNavClient';
import { SystemLogsMonitor } from '../../../logs';
import { BootstrapTab } from './BootstrapTab';

/** The page's tab ids; the `?tab=` value carried by each submenu node. */
type ToolsAdminTabId = 'bootstrap' | 'logs';

/**
 * Log service name the module's entries are stored under. `ToolsModule` logs
 * through `logger.child({ module: 'tools' })`, which the log store files as
 * `tronrelic:tools`.
 */
const LOG_SERVICE = 'tronrelic:tools';

/**
 * Narrow an arbitrary `?tab=` value to a known tab, so the deep link and the
 * click routing share one list of valid tabs.
 *
 * @param tab - The raw value.
 * @returns Whether it names a tab on this page.
 */
function isToolsAdminTabId(tab: string | undefined): tab is ToolsAdminTabId {
    return tab === 'bootstrap' || tab === 'logs';
}

/**
 * Read the tab a submenu node points at, falling back to Bootstrap for a
 * malformed node so the page never lands on a blank panel.
 *
 * @param url - The clicked node's url, such as `/system/tools?tab=logs`.
 * @returns The tab to show.
 */
function tabFromUrl(url: string | undefined): ToolsAdminTabId {
    const tab = url?.match(/[?&]tab=([^&]+)/)?.[1];
    return isToolsAdminTabId(tab) ? tab : 'bootstrap';
}

/**
 * Props for {@link ToolsAdminClient}.
 */
interface IToolsAdminClientProps {
    /** The tab row's nodes, read on the server for this admin. */
    submenuTree: MenuNodeSerialized[];
    /** When the backend produced the tab row, seeded onto the menu store. */
    submenuGeneratedAt: string;
    /** The bootstrap rows read on the server, so the Bootstrap tab opens with data; null when the read failed. */
    initialBootstrapPages: IToolsBootstrapPage[] | null;
    /** The `?tab=` value from the request; an unknown or absent value opens Bootstrap. */
    initialTab?: string;
}

/**
 * Tools admin page shell.
 *
 * @param props - The server-read tab row, bootstrap rows, and deep-linked tab.
 * @returns The page.
 */
export function ToolsAdminClient({ submenuTree, submenuGeneratedAt, initialBootstrapPages, initialTab }: IToolsAdminClientProps) {
    const [activeTab, setActiveTab] = useState<ToolsAdminTabId>(isToolsAdminTabId(initialTab) ? initialTab : 'bootstrap');

    /**
     * Switch panels and rewrite the address in place, because `MenuNavClient`
     * cancels the link navigation when `onItemSelect` is set and the address
     * bar would otherwise never show the selected tab.
     */
    const handleTabSelect = useCallback((item: MenuNodeSerialized) => {
        const tab = tabFromUrl(item.url);
        setActiveTab(tab);
        window.history.replaceState(null, '', `/system/tools?tab=${tab}`);
    }, []);

    return (
        <AdminPage
            title="Tools"
            subtitle="The public TRON tools: create the editable pages this module ships, and read its logs."
        >
            <MenuNavClient
                namespace={TOOLS_ADMIN_SUBMENU_NAMESPACE}
                items={submenuTree}
                generatedAt={submenuGeneratedAt}
                ariaLabel="Tools sections"
                activeUrl={`/system/tools?tab=${activeTab}`}
                onItemSelect={handleTabSelect}
            />

            {activeTab === 'bootstrap' && <BootstrapTab initialPages={initialBootstrapPages} />}
            {activeTab === 'logs' && <SystemLogsMonitor service={LOG_SERVICE} title="Tools Logs" />}
        </AdminPage>
    );
}
