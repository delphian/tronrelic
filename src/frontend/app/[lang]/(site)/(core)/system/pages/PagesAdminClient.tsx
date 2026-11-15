'use client';

/**
 * @fileoverview Client shell for /system/pages.
 *
 * Holds the in-page tab row and its four panels: the page list and editor,
 * the route blacklist settings, the pages module's MongoDB storage, and the
 * pages module's log entries. The tab row is the menu module's Submenu
 * Pattern, a namespaced menu rendered with `MenuNavClient`, so it inherits
 * per-user gating, ordering, and live `menu:update` refresh. Clicking a tab
 * changes local state instead of navigating, and the address bar is kept as a
 * real deep link.
 *
 * The shell owns the page's single `<Page>` and `<h1>`, so every panel renders
 * sections only. File browsing and upload-policy settings live at
 * /system/files. The module registers no scheduler jobs, so there is no
 * Schedules tab.
 */

import { useCallback, useState } from 'react';
import type { MenuNodeSerialized } from '@/shared';
import { Page, PageHeader, Stack } from '../../../../../../components/layout';
import { MenuNavClient } from '../../../../../../components/layout/MenuNav/MenuNavClient';
import { CollectionBrowser } from '../../../../../../modules/database';
import { SystemLogsMonitor } from '../../../../../../modules/logs';
import { PagesTab } from './tabs/PagesTab';
import { SettingsTab } from './tabs/SettingsTab';

/** The page's tab ids; the `?tab=` value carried by each submenu node. */
type TabId = 'pages' | 'settings' | 'database' | 'logs';

/** Every tab id, so the deep link and the click handler share one list. */
const TAB_IDS: ReadonlyArray<TabId> = ['pages', 'settings', 'database', 'logs'];

/** The menu namespace the pages module registers the tab nodes under. */
const SUBMENU_NAMESPACE = 'pages';

/**
 * Collection prefixes covering the pages module's storage. The `pages` and
 * `page_settings` collections predate the `module_<id>_` naming convention, so
 * the `page` prefix reaches them; the translated text follows the convention
 * as `module_pages_translation_values`. A collection browser takes one prefix,
 * so the Database tab shows one browser per prefix. Repeated from the backend
 * because frontend code cannot import backend code.
 */
const LEGACY_COLLECTION_PREFIX = 'page';
const MODULE_COLLECTION_PREFIX = 'module_pages_';

/** Log service name a module logging through `logger.child({ module: 'pages' })` records under. */
const LOG_SERVICE = 'tronrelic:pages';

/**
 * Narrow an arbitrary `?tab=` string to a known tab.
 *
 * @param tab - The raw `?tab=` value.
 * @returns True when the value names a real tab.
 */
function isTabId(tab: string | undefined): tab is TabId {
    return TAB_IDS.includes(tab as TabId);
}

/**
 * Resolve a submenu node's `?tab=` value, defaulting to `pages` so a
 * malformed node never leaves the page on a blank panel.
 *
 * @param url - The clicked node's url, such as `/system/pages?tab=logs`.
 * @returns The tab the node stands for.
 */
function tabFromUrl(url: string | undefined): TabId {
    const tab = url?.match(/[?&]tab=([^&]+)/)?.[1];
    return isTabId(tab) ? tab : 'pages';
}

/** Props for the client shell. */
interface IPagesAdminClientProps {
    /** Server-fetched submenu nodes (the tab row), already gated for the admin. */
    submenuTree: MenuNodeSerialized[];
    /** Snapshot timestamp of the submenu tree, seeded onto the menu Redux slice. */
    submenuGeneratedAt: string;
    /** The `?tab=` value from the request URL; unknown or absent opens Pages. */
    initialTab?: string;
}

/**
 * Pages admin shell: header, tab row, and the active panel.
 *
 * @param props - Submenu tree, its timestamp, and the deep-linked tab.
 * @returns The page.
 */
export function PagesAdminClient({ submenuTree, submenuGeneratedAt, initialTab }: IPagesAdminClientProps) {
    const [activeTab, setActiveTab] = useState<TabId>(isTabId(initialTab) ? initialTab : 'pages');

    /**
     * Switch to the clicked tab and keep the address bar a real deep link.
     * `MenuNavClient` suppresses navigation when `onItemSelect` is set, so the
     * URL is rewritten in place and a refresh or shared link opens the same tab.
     */
    const handleTabSelect = useCallback((item: MenuNodeSerialized) => {
        const tab = tabFromUrl(item.url);
        setActiveTab(tab);
        window.history.replaceState(null, '', `/system/pages?tab=${tab}`);
    }, []);

    return (
        <Page>
            {/* One Stack holds the header, the tab row, and the active panel so
                they sit one stack gap apart instead of the page's wider gap. */}
            <Stack gap="md">
                <PageHeader
                    title="Pages"
                    subtitle="Markdown pages, their translations, and the routes custom pages may not claim."
                />

                <MenuNavClient
                    namespace={SUBMENU_NAMESPACE}
                    items={submenuTree}
                    generatedAt={submenuGeneratedAt}
                    ariaLabel="Pages sections"
                    activeUrl={`/system/pages?tab=${activeTab}`}
                    onItemSelect={handleTabSelect}
                />

                {activeTab === 'pages' && <PagesTab />}
                {activeTab === 'settings' && <SettingsTab />}

                {/* Read-only. Pages are managed content: an edit made here
                    would skip the core content service, its review hold, and
                    its audit. Pages are changed on the Pages tab. */}
                {activeTab === 'database' && (
                    <Stack gap="md">
                        <CollectionBrowser
                            prefix={LEGACY_COLLECTION_PREFIX}
                            title="Page Collections"
                            allowEdit={false}
                            allowDelete={false}
                        />
                        <CollectionBrowser
                            prefix={MODULE_COLLECTION_PREFIX}
                            title="Translation Collections"
                            allowEdit={false}
                            allowDelete={false}
                        />
                    </Stack>
                )}
                {activeTab === 'logs' && <SystemLogsMonitor service={LOG_SERVICE} title="Pages Logs" />}
            </Stack>
        </Page>
    );
}
