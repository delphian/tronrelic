'use client';

/**
 * @fileoverview Client shell for /system/system.
 *
 * Hosts the in-page tab row (the menu module's Submenu Pattern — a namespaced
 * menu rendered with `MenuNavClient`, not a hand-rolled control) and the tab
 * panels. The server entry fetches the `system` namespace tree SSR-first and
 * passes it in; clicking a tab drives local state via `onItemSelect` rather than
 * navigating, and `activeUrl` highlights the active tab since the route is
 * identical across them.
 *
 * "Pipeline" is the default tab, because block ingestion is what operators come
 * to this page to check. Its payload is fetched on the server so the tab renders
 * with real figures on first paint. "Server" holds the droplet, container,
 * Redis, and process readings that used to sit above the blockchain console on
 * the old Overview tab. "Schedules" and "Logs" are scoped to the blockchain
 * jobs and to the `tronrelic:blockchain` log service, so an operator diagnosing
 * sync stays on this page. Configuration, WebSockets, MongoDB, and ClickHouse
 * each own a tab; a panel mounts only while its tab is active, so its fetches
 * fire on arrival rather than on page load.
 *
 * The tab row and the active panel are siblings inside ONE `Stack`, which is
 * what keeps the page's vertical rhythm coherent. `Page` is a grid whose gap is
 * `--page-gap` (3rem) — the right distance between page-level sections, and far
 * too much between a tab row and the panel it controls. Giving `Page` a single
 * child confines that 3rem to the page edge and lets the stack own the interior.
 *
 * This page renders no `PageHeader` on purpose. The tab row already names the
 * surface, and an operator arrives here to read telemetry above the fold.
 */

import { useState, useCallback } from 'react';
import type { MenuNodeSerialized } from '@/shared';
import type { IPipelineStatus } from '@/types';
import { Page, Stack } from '../../../../components/layout';
import { MenuNavClient } from '../../../../components/layout/MenuNav/MenuNavClient';
import { Card } from '../../../../components/ui/Card';
import { SchedulerMonitor, type SchedulerJob } from '../../../../modules/scheduler';
import { SystemLogsMonitor } from '../../../../modules/logs';
import { PipelineTab } from './components/pipeline/PipelineTab';
import { ServerTab } from './components/ServerTab';
import { SectionPanel } from './components/SectionPanel';
import { ConfigurationTab } from './components/ConfigurationTab';
import { WebSocketsSection } from './components/WebSocketsSection';
import { MongoSection } from './components/MongoSection';
import { ClickHouseSection } from './components/ClickHouseSection';
import { toTabId, type SystemTabId } from './system-tabs';

/** The menu namespace the tab nodes are registered under. */
const SUBMENU_NAMESPACE = 'system';

/** Service name the blockchain module's log entries are stored under. */
const BLOCKCHAIN_LOG_SERVICE = 'tronrelic:blockchain';

/**
 * Select the scheduler jobs that belong to the block pipeline.
 *
 * Matches by prefix rather than a fixed list, so a pipeline job added later
 * appears on the Schedules tab with no change here.
 *
 * @param job - One scheduler job.
 * @returns True for `blockchain:*` and `network-activity:*` jobs.
 */
const isPipelineJob = (job: SchedulerJob): boolean =>
    job.name.startsWith('blockchain:') || job.name.startsWith('network-activity:');

/**
 * Props for the client shell.
 */
interface ISystemAdminClientProps {
    /** SSR-fetched submenu nodes (the tab row), already gated for the admin. */
    submenuTree: MenuNodeSerialized[];
    /** Snapshot timestamp of the submenu tree, seeded onto the menu Redux slice. */
    submenuGeneratedAt: string;
    /** The `?tab=` value from the request URL; unknown/absent resolves to `pipeline`. */
    initialTab?: string;
    /**
     * The Pipeline tab's payload, fetched on the server so the default tab
     * renders with real figures on first paint, or null when the fetch failed.
     */
    initialPipeline: IPipelineStatus | null;
}

/**
 * Resolve a submenu node's url to a known tab id.
 *
 * @param url - The clicked node's url (e.g. `/system/system?tab=mongo`).
 * @returns The matching tab id.
 */
function tabFromUrl(url: string | undefined): SystemTabId {
    return toTabId(url?.match(/[?&]tab=([^&]+)/)?.[1]);
}

/**
 * System admin client shell.
 *
 * @param props - SSR submenu tree, its timestamp, the deep-linked initial tab,
 *                and the server-fetched pipeline payload.
 * @returns The page.
 */
export function SystemAdminClient({ submenuTree, submenuGeneratedAt, initialTab, initialPipeline }: ISystemAdminClientProps) {
    const [activeTab, setActiveTab] = useState<SystemTabId>(toTabId(initialTab));

    /**
     * Activate a tab and keep its URL a real deep link.
     *
     * `MenuNavClient` suppresses the <Link> navigation when `onItemSelect` is set,
     * so rewrite the address in place with `history.replaceState` — no server
     * round-trip — so the `?tab=` URLs become true deep links the server entry can
     * read SSR-first on next load.
     *
     * @param tab - The tab to activate.
     */
    const activateTab = useCallback((tab: SystemTabId) => {
        setActiveTab(tab);
        window.history.replaceState(null, '', `/system/system?tab=${tab}`);
    }, []);

    /**
     * Activate the clicked submenu tab.
     *
     * @param item - The clicked submenu node, carrying its `?tab=` url.
     */
    const handleTabSelect = useCallback((item: MenuNodeSerialized) => {
        activateTab(tabFromUrl(item.url));
    }, [activateTab]);

    /**
     * Open the Configuration tab from a control on another tab, such as the
     * Buffer stage card's settings button.
     */
    const openSettings = useCallback(() => {
        activateTab('config');
    }, [activateTab]);

    return (
        <Page>
            <Stack gap="lg">
                <MenuNavClient
                    namespace={SUBMENU_NAMESPACE}
                    items={submenuTree}
                    generatedAt={submenuGeneratedAt}
                    ariaLabel="System sections"
                    activeUrl={`/system/system?tab=${activeTab}`}
                    onItemSelect={handleTabSelect}
                />

                {activeTab === 'pipeline' && <PipelineTab initialPipeline={initialPipeline} onOpenSettings={openSettings} />}
                {activeTab === 'server' && <ServerTab />}
                {/* Configuration supplies its own cards — the site URL panel and each
                  * provider section are independent surfaces with independent save
                  * controls, so they sit as siblings rather than in one shared panel. */}
                {activeTab === 'config' && <ConfigurationTab />}
                {activeTab === 'schedules' && (
                    <Card padding="sm" noBackgroundImage>
                        <SchedulerMonitor jobFilter={isPipelineJob} title="Block Pipeline Schedules" hideStats />
                    </Card>
                )}
                {activeTab === 'logs' && (
                    <Card padding="sm" noBackgroundImage>
                        <SystemLogsMonitor service={BLOCKCHAIN_LOG_SERVICE} title="Block Pipeline Logs" />
                    </Card>
                )}
                {activeTab === 'websockets' && <SectionPanel><WebSocketsSection /></SectionPanel>}
                {/* MongoDB supplies its own cards — health, browser, and migrations are
                  * independent surfaces, so they sit as siblings rather than inside the
                  * shared single-section panel. */}
                {activeTab === 'mongo' && <MongoSection />}
                {/* ClickHouse supplies its own cards — health and tables, the accounts
                  * panel, and the accounts module's records are independent surfaces,
                  * so they sit as siblings as MongoDB's do. */}
                {activeTab === 'clickhouse' && <ClickHouseSection />}
            </Stack>
        </Page>
    );
}
