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
 * "Overview" carries the telemetry strip plus the Server and Blockchain consoles.
 * Configuration, WebSockets, MongoDB, and ClickHouse each own a tab; every
 * section on this page renders expanded, and a panel mounts only while its tab
 * is active, so its fetches fire on arrival rather than on page load.
 * "Providers" hosts external-provider config.
 */

import { useState, useCallback, type MouseEvent as ReactMouseEvent } from 'react';
import type { MenuNodeSerialized } from '@/shared';
import { Page } from '../../../../components/layout';
import { MenuNavClient } from '../../../../components/layout/MenuNav/MenuNavClient';
import { OverviewTab } from './components/OverviewTab';
import { ProvidersTab } from './components/ProvidersTab';
import { SectionPanel } from './components/SectionPanel';
import { SystemConfigSection } from './components/SystemConfigSection';
import { WebSocketsSection } from './components/WebSocketsSection';
import { MongoSection } from './components/MongoSection';
import { ClickHouseSection } from './components/ClickHouseSection';
import styles from './page.module.scss';

/** The page's tab ids; the `?tab=` value carried by each submenu node. */
type TabId = 'overview' | 'config' | 'websockets' | 'mongo' | 'clickhouse' | 'providers';

/** The menu namespace the tab nodes are registered under. */
const SUBMENU_NAMESPACE = 'system';

/** Default panel for an absent or unrecognized `?tab=` value. */
const DEFAULT_TAB: TabId = 'overview';

/**
 * Every valid tab id, used to validate the `?tab=` value from a URL before it
 * reaches state. Kept as a Set so an unknown value falls back to Overview rather
 * than rendering a blank panel — the `?tab=` values are user-editable.
 */
const TAB_IDS = new Set<string>(['overview', 'config', 'websockets', 'mongo', 'clickhouse', 'providers']);

/**
 * Telemetry tiles whose subsystem moved off the Overview tab.
 *
 * The tile ids come from `OverviewBar`; each maps to the tab that now owns that
 * subsystem. A tile absent from this map (Server, Blockchain) still renders on
 * the Overview tab, so its `#id` anchor resolves and plain anchor behavior is
 * left alone.
 */
const TILE_TABS: Record<string, TabId> = {
    config: 'config',
    websockets: 'websockets',
    mongo: 'mongo',
    clickhouse: 'clickhouse'
};

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
 * Resolve a `?tab=` value to a known TabId, defaulting to `overview`.
 *
 * @param tab - A raw `?tab=` value from a URL or submenu node.
 * @returns The matching tab id, or `overview` when unrecognized.
 */
function toTabId(tab: string | undefined): TabId {
    return tab && TAB_IDS.has(tab) ? (tab as TabId) : DEFAULT_TAB;
}

/**
 * Resolve a submenu node's url to a known TabId.
 *
 * @param url - The clicked node's url (e.g. `/system/system?tab=mongo`).
 * @returns The matching tab id.
 */
function tabFromUrl(url: string | undefined): TabId {
    return toTabId(url?.match(/[?&]tab=([^&]+)/)?.[1]);
}

/**
 * System admin client shell.
 *
 * @param props - SSR submenu tree, its timestamp, and the deep-linked initial tab.
 * @returns The page.
 */
export function SystemAdminClient({ submenuTree, submenuGeneratedAt, initialTab }: ISystemAdminClientProps) {
    const [activeTab, setActiveTab] = useState<TabId>(toTabId(initialTab));

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
    const activateTab = useCallback((tab: TabId) => {
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
     * Route a telemetry tile click to the tab that owns its subsystem.
     *
     * Tiles are anchors to a section card's `#id`. For the four subsystems that
     * moved to their own tab that target no longer exists on the Overview tab, so
     * suppress the anchor and switch tabs instead; tiles still backed by a card
     * on this tab keep their scroll behavior untouched.
     *
     * @param tileId - The clicked tile's id, matching its section card id.
     * @param event - The click, cancelled only when the tile owns a tab.
     */
    const handleTileSelect = useCallback((tileId: string, event: ReactMouseEvent<HTMLAnchorElement>) => {
        const tab = TILE_TABS[tileId];
        if (!tab) {
            return;
        }
        event.preventDefault();
        activateTab(tab);
    }, [activateTab]);

    return (
        <Page>
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
                {activeTab === 'overview' && <OverviewTab onTileSelect={handleTileSelect} />}
                {activeTab === 'config' && <SectionPanel><SystemConfigSection /></SectionPanel>}
                {activeTab === 'websockets' && <SectionPanel><WebSocketsSection /></SectionPanel>}
                {/* MongoDB supplies its own cards — health, browser, and migrations are
                  * independent surfaces, so they sit as siblings rather than inside the
                  * shared single-section panel. */}
                {activeTab === 'mongo' && <MongoSection />}
                {activeTab === 'clickhouse' && <SectionPanel><ClickHouseSection /></SectionPanel>}
                {activeTab === 'providers' && <ProvidersTab />}
            </div>
        </Page>
    );
}
