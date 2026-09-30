'use client';

/**
 * @fileoverview Client shell for /system/mcp.
 *
 * The master kill switch sits above the tab row, so it is on screen whatever
 * tab is open: an operator responding to an incident never has to find the
 * right tab first. Below it, the tab row is the menu module's Submenu Pattern
 * (a namespaced menu rendered with `MenuNavClient`), and the panels are:
 *
 * - Overview: the connection URL and headline counts.
 * - Tools: approve or withdraw each tool for MCP.
 * - Connected apps: every user's grants, revocable.
 * - Activity: the governor's audit feed, locked to the `mcp` trigger path.
 * - Database: the module's own collections.
 * - Logs: the module's log entries.
 */

import { useCallback, useState } from 'react';
import type { MenuNodeSerialized } from '@/shared';
import type { IConnectedAppAdminRow, IMcpSettings, IMcpStatus, IMcpToolExposure } from '@/types';
import { Page, PageHeader } from '../../../../components/layout';
import { MenuNavClient } from '../../../../components/layout/MenuNav/MenuNavClient';
import { CollectionBrowser } from '../../../../modules/database';
import { SystemLogsMonitor } from '../../../../modules/logs';
import { ActivityTab } from '../ai-tools/tabs/ActivityTab';
import { KillSwitchCard } from './KillSwitchCard';
import { OverviewTab } from './OverviewTab';
import { ToolsTab } from './ToolsTab';
import { AppsTab } from './AppsTab';
import styles from './page.module.scss';

/** The page's tab ids; the `?tab=` value carried by each submenu node. */
type TabId = 'overview' | 'tools' | 'apps' | 'activity' | 'database' | 'logs';

/** Menu namespace the MCP module registers the tab nodes under. */
const SUBMENU_NAMESPACE = 'mcp';

/**
 * Physical collection prefix for everything the MCP module owns: its settings
 * document and its tool approvals. OAuth grants are identity-owned and live in
 * the `module_user_auth_oauth_*` collections instead.
 */
const COLLECTION_PREFIX = 'module_mcp_';

/** Log service name the module's `logger.child({ module: 'mcp' })` records under. */
const LOG_SERVICE = 'tronrelic:mcp';

/**
 * Narrow a `?tab=` value to a known tab.
 *
 * @param tab - The raw value.
 * @returns True when it names a tab.
 */
function isTabId(tab: string | undefined): tab is TabId {
    return tab === 'overview' || tab === 'tools' || tab === 'apps' || tab === 'activity' || tab === 'database' || tab === 'logs';
}

/**
 * Resolve a submenu node's url to its tab, defaulting to the overview.
 *
 * @param url - The clicked node's url.
 * @returns The tab id.
 */
function tabFromUrl(url: string | undefined): TabId {
    const tab = url?.match(/[?&]tab=([^&]+)/)?.[1];
    return isTabId(tab) ? tab : 'overview';
}

/**
 * Props for {@link McpAdminClient}.
 */
interface IMcpAdminClientProps {
    /** SSR-fetched tab row nodes. */
    submenuTree: MenuNodeSerialized[];
    /** Snapshot time of the tab row. */
    submenuGeneratedAt: string;
    /** The `?tab=` deep link. */
    initialTab?: string;
    /** SSR-fetched status; null when the fetch failed. */
    initialStatus: IMcpStatus | null;
    /** SSR-fetched tool rows. */
    initialTools: IMcpToolExposure[];
    /** SSR-fetched first page of connected apps. */
    initialApps: IConnectedAppAdminRow[];
    /** Total connected apps across all users. */
    initialAppsTotal: number;
}

/**
 * MCP admin client shell.
 *
 * @param props - {@link IMcpAdminClientProps}.
 * @returns The page.
 */
export function McpAdminClient({
    submenuTree,
    submenuGeneratedAt,
    initialTab,
    initialStatus,
    initialTools,
    initialApps,
    initialAppsTotal
}: IMcpAdminClientProps) {
    const [activeTab, setActiveTab] = useState<TabId>(isTabId(initialTab) ? initialTab : 'overview');
    const [status, setStatus] = useState<IMcpStatus | null>(initialStatus);

    /**
     * Switch tabs and keep the URL a real deep link, without navigating.
     *
     * @param item - The clicked submenu node.
     */
    const handleTabSelect = useCallback((item: MenuNodeSerialized) => {
        const tab = tabFromUrl(item.url);
        setActiveTab(tab);
        window.history.replaceState(null, '', `/system/mcp?tab=${tab}`);
    }, []);

    /**
     * Fold a tool change into the overview counts without a round trip, so
     * the served and stale counts beside the kill switch stay accurate.
     *
     * @param tools - The tool rows after the change.
     */
    const handleToolsChanged = useCallback((tools: IMcpToolExposure[]) => {
        setStatus(current => current
            ? { ...current, servedToolCount: tools.filter(t => t.served).length, staleToolCount: tools.filter(t => t.stale).length }
            : current);
    }, []);

    /**
     * Fold a kill-switch change into the current status. A functional update
     * keeps the tool counts current even when a tool changed while the
     * switch request was in flight.
     *
     * @param settings - The stored settings returned by the switch request.
     */
    const handleSettingsChanged = useCallback((settings: IMcpSettings) => {
        setStatus(current => current ? { ...current, settings } : current);
    }, []);

    return (
        <Page>
            <PageHeader
                title="MCP"
                subtitle="Let members of the mcp-users group connect their own AI client to TronRelic and call the read-only tools you approve."
            />

            <KillSwitchCard status={status} onSettingsChange={handleSettingsChanged} />

            <div className={styles.submenu}>
                <MenuNavClient
                    namespace={SUBMENU_NAMESPACE}
                    items={submenuTree}
                    generatedAt={submenuGeneratedAt}
                    ariaLabel="MCP sections"
                    activeUrl={`/system/mcp?tab=${activeTab}`}
                    onItemSelect={handleTabSelect}
                />
            </div>

            <div className={styles.content}>
                {activeTab === 'overview' && <OverviewTab status={status} />}
                {/* Tools and Apps stay mounted and are only hidden, because they
                    seed their state from the SSR props once. Unmounting them on a
                    tab switch would bring back the SSR snapshot, so an approval or
                    a revocation made earlier would appear to be undone. */}
                <div hidden={activeTab !== 'tools'}>
                    <ToolsTab initialTools={initialTools} onToolsChanged={handleToolsChanged} />
                </div>
                <div hidden={activeTab !== 'apps'}>
                    <AppsTab initialApps={initialApps} initialTotal={initialAppsTotal} />
                </div>
                {activeTab === 'activity' && <ActivityTab fixedTriggerPath="mcp" />}
                {activeTab === 'database' && <CollectionBrowser prefix={COLLECTION_PREFIX} title="MCP Collections" />}
                {activeTab === 'logs' && <SystemLogsMonitor service={LOG_SERVICE} />}
            </div>
        </Page>
    );
}
