'use client';

/**
 * @fileoverview Client shell for /system/consent.
 *
 * Holds the in-page tab row and its three panels: the settings, this module's
 * MongoDB storage, and this module's log entries. The tab row is the menu
 * module's Submenu Pattern — a namespaced menu rendered with `MenuNavClient` —
 * and clicking a tab drives local state rather than navigating, with the
 * address bar kept as a real deep link.
 *
 * The Database and Logs panels are core components scoped to this module, so
 * an operator checking who switched consent on, or why a save was refused,
 * can read the module's storage and its log entries without leaving the page.
 * The module owns no scheduler jobs, so there is no Schedules tab.
 */

import { useCallback, useState } from 'react';
import type { MenuNodeSerialized } from '@/shared';
import { Page, PageHeader, Stack } from '../../../../../../components/layout';
import { MenuNavClient } from '../../../../../../components/layout/MenuNav/MenuNavClient';
import { CollectionBrowser } from '../../../../../../modules/database';
import { SystemLogsMonitor } from '../../../../../../modules/logs';
import { SettingsTab } from '../../../../../../modules/consent';

/** The page's tab ids; the `?tab=` value carried by each submenu node. */
type TabId = 'settings' | 'database' | 'logs';

/** Every tab id, so the deep link and the click handler share one list. */
const TAB_IDS: ReadonlyArray<TabId> = ['settings', 'database', 'logs'];

/** The menu namespace the module registers the tab nodes under. */
const SUBMENU_NAMESPACE = 'consent';

/**
 * Physical collection prefix covering everything this module owns. Repeated
 * from the backend module because frontend code cannot import backend code.
 */
const COLLECTION_PREFIX = 'module_consent_';

/** Log service name a module logging through `logger.child({ module: 'consent' })` records under. */
const LOG_SERVICE = 'tronrelic:consent';

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
 * Resolve a submenu node's `?tab=` value, defaulting to `settings` so a
 * malformed node never leaves the page on a blank panel.
 *
 * @param url - The clicked node's url, e.g. `/system/consent?tab=logs`.
 * @returns The matching tab id.
 */
function tabFromUrl(url: string | undefined): TabId {
    const tab = url?.match(/[?&]tab=([^&]+)/)?.[1];
    return isTabId(tab) ? tab : 'settings';
}

/** Props for the client shell. */
interface IConsentAdminClientProps {
    /** Server-fetched submenu nodes (the tab row), already gated for the admin. */
    submenuTree: MenuNodeSerialized[];
    /** Snapshot timestamp of the submenu tree. */
    submenuGeneratedAt: string;
    /** The `?tab=` value from the request URL; unknown or absent opens Settings. */
    initialTab?: string;
}

/**
 * Consent admin shell: header, tab row, and the active panel.
 *
 * @param props - Submenu tree, its timestamp, and the deep-linked tab.
 * @returns The page.
 */
export function ConsentAdminClient({ submenuTree, submenuGeneratedAt, initialTab }: IConsentAdminClientProps) {
    const [activeTab, setActiveTab] = useState<TabId>(isTabId(initialTab) ? initialTab : 'settings');

    /**
     * Switch to the clicked tab and keep the address bar a real deep link.
     * `MenuNavClient` suppresses navigation when `onItemSelect` is set, so the
     * URL is rewritten in place.
     *
     * @param item - The clicked submenu node.
     */
    const handleTabSelect = useCallback((item: MenuNodeSerialized) => {
        const tab = tabFromUrl(item.url);
        setActiveTab(tab);
        window.history.replaceState(null, '', `/system/consent?tab=${tab}`);
    }, []);

    return (
        <Page>
            {/* One Stack holds the header, the tab row, and the active panel so
                they sit one stack gap apart instead of the page's wider gap. */}
            <Stack gap="md">
                <PageHeader
                    title="Consent"
                    subtitle="The cookie banner for visitors in the EEA, the UK, and Switzerland, and the Google Ads tag it controls."
                />

                <MenuNavClient
                    namespace={SUBMENU_NAMESPACE}
                    items={submenuTree}
                    generatedAt={submenuGeneratedAt}
                    ariaLabel="Consent sections"
                    activeUrl={`/system/consent?tab=${activeTab}`}
                    onItemSelect={handleTabSelect}
                />

                {activeTab === 'settings' && <SettingsTab />}
                {activeTab === 'database' && (
                    <CollectionBrowser prefix={COLLECTION_PREFIX} title="Consent Collections" />
                )}
                {activeTab === 'logs' && <SystemLogsMonitor service={LOG_SERVICE} />}
            </Stack>
        </Page>
    );
}
