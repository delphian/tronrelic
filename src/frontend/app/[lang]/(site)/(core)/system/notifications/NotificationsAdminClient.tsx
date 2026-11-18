'use client';

/**
 * @fileoverview Client shell for /system/notifications.
 *
 * Holds the in-page tab row and its six panels: the category and channel kill
 * switches, the audit feed, the signed-in admin's own opt-outs, this module's
 * MongoDB storage, and this module's log entries. The tab row is the menu
 * module's Submenu Pattern — a namespaced menu rendered with `MenuNavClient` —
 * and clicking a tab drives local state rather than navigating, with the
 * address bar kept as a real deep link.
 *
 * The Database and Logs panels are core components scoped to this module, so
 * an operator checking why a notification was not delivered can read the
 * policy document, the audit rows, and the dispatch log entries without
 * leaving the page. The module owns no scheduler jobs, so there is no
 * Schedules tab.
 */

import { useCallback, useState } from 'react';
import type { MenuNodeSerialized } from '@/shared';
import { AdminPage } from '../../../../../../components/layout';
import { MenuNavClient } from '../../../../../../components/layout/MenuNav/MenuNavClient';
import { CollectionBrowser } from '../../../../../../modules/database';
import { SystemLogsMonitor } from '../../../../../../modules/logs';
import { PreferencesPanel, CategoriesTab, ChannelsTab, HistoryTab } from '../../../../../../modules/notifications';

/** The page's tab ids; the `?tab=` value carried by each submenu node. */
type TabId = 'categories' | 'channels' | 'history' | 'preferences' | 'database' | 'logs';

/** Every tab id, so the deep link and the click handler share one list. */
const TAB_IDS: ReadonlyArray<TabId> = ['categories', 'channels', 'history', 'preferences', 'database', 'logs'];

/**
 * The tab the page opens on when the address names none. Categories is the
 * first of the admin tabs the module registers, and the reason most operators
 * open the page.
 */
const DEFAULT_TAB: TabId = 'categories';

/** The menu namespace the notifications module registers the tab nodes under. */
const SUBMENU_NAMESPACE = 'notifications';

/**
 * Physical collection prefix covering everything this module owns, the policy
 * and audit collections. Per-user opt-outs live in the identity module's
 * `module_user_settings`, outside this prefix. Repeated from the backend
 * module because frontend code cannot import backend code.
 */
const COLLECTION_PREFIX = 'module_notifications_';

/** Log service name a module logging through `logger.child({ module: 'notifications' })` records under. */
const LOG_SERVICE = 'tronrelic:notifications';

/** Narrow an arbitrary `?tab=` string to a known tab. */
function isTabId(tab: string | undefined): tab is TabId {
    return TAB_IDS.includes(tab as TabId);
}

/**
 * Resolve a submenu node's `?tab=` value, defaulting to the first admin tab so
 * a malformed node never leaves the page on a blank panel.
 *
 * @param url - The clicked node's url, e.g. `/system/notifications?tab=history`.
 */
function tabFromUrl(url: string | undefined): TabId {
    const tab = url?.match(/[?&]tab=([^&]+)/)?.[1];
    return isTabId(tab) ? tab : DEFAULT_TAB;
}

/** Props for the client shell. */
interface INotificationsAdminClientProps {
    /** Server-fetched submenu nodes (the tab row), already gated for the admin. */
    submenuTree: MenuNodeSerialized[];
    /** Snapshot timestamp of the submenu tree. */
    submenuGeneratedAt: string;
    /** The `?tab=` value from the request URL; unknown or absent opens Categories. */
    initialTab?: string;
}

/**
 * Notifications admin shell: header, tab row, and the active panel.
 *
 * @param props - Submenu tree, its timestamp, and the deep-linked tab.
 * @returns The page.
 */
export function NotificationsAdminClient({ submenuTree, submenuGeneratedAt, initialTab }: INotificationsAdminClientProps) {
    const [activeTab, setActiveTab] = useState<TabId>(isTabId(initialTab) ? initialTab : DEFAULT_TAB);

    /**
     * Switch to the clicked tab and keep the address bar a real deep link.
     * `MenuNavClient` suppresses navigation when `onItemSelect` is set, so the
     * URL is rewritten in place.
     */
    const handleTabSelect = useCallback((item: MenuNodeSerialized) => {
        const tab = tabFromUrl(item.url);
        setActiveTab(tab);
        window.history.replaceState(null, '', `/system/notifications?tab=${tab}`);
    }, []);

    return (
        <AdminPage
            title="Notifications"
            subtitle="Govern categories and channels, audit every blast, and silence your own notifications."
        >
            <MenuNavClient
                namespace={SUBMENU_NAMESPACE}
                items={submenuTree}
                generatedAt={submenuGeneratedAt}
                ariaLabel="Notification administration sections"
                activeUrl={`/system/notifications?tab=${activeTab}`}
                onItemSelect={handleTabSelect}
            />

            {activeTab === 'categories' && <CategoriesTab />}
            {activeTab === 'channels' && <ChannelsTab />}
            {activeTab === 'history' && <HistoryTab />}
            {/* Titled, so the matrix draws its own panel with "Mute all" in
              * the header; /profile wraps it in a panel of its own instead. */}
            {activeTab === 'preferences' && <PreferencesPanel title="My notifications" />}

            {/* Read-only. The audit rows are the record of what was sent and
              * to whom, so editing or deleting one would falsify the history
              * the History tab reports, and the policy document is changed
              * through the Categories and Channels tabs, which validate the
              * ids they write. */}
            {activeTab === 'database' && (
                <CollectionBrowser
                    prefix={COLLECTION_PREFIX}
                    title="Notifications Collections"
                    allowEdit={false}
                    allowDelete={false}
                />
            )}
            {activeTab === 'logs' && <SystemLogsMonitor service={LOG_SERVICE} />}
        </AdminPage>
    );
}
