'use client';

/**
 * @fileoverview Client shell for /system/users.
 *
 * Holds the in-page tab row and its four panels: the account directory, the
 * user groups, the identity module's MongoDB storage, and the identity
 * module's log entries. The tab row is the menu module's Submenu Pattern, a
 * namespaced menu rendered with `MenuNavClient`, so it inherits per-user
 * gating, ordering, and live `menu:update` refresh. Clicking a tab changes
 * local state instead of navigating, and the address bar is kept as a real
 * deep link.
 *
 * The Database and Logs panels are core components scoped to the identity
 * module. The Logs panel is where sign-in code requests, sign-ins, failed
 * attempts, and rate-limit refusals appear, so an operator can answer "who
 * requested this code" without leaving the page. The module registers no
 * scheduler jobs, so there is no Schedules tab.
 */

import { useCallback, useState } from 'react';
import type { MenuNodeSerialized } from '@/shared';
import { Page, PageHeader, Stack } from '../../../../../../components/layout';
import { MenuNavClient } from '../../../../../../components/layout/MenuNav/MenuNavClient';
import { CollectionBrowser } from '../../../../../../modules/database';
import { SystemLogsMonitor } from '../../../../../../modules/logs';
import { UsersMonitor, GroupsManager } from '../../../../../../modules/user';

/** The page's tab ids; the `?tab=` value carried by each submenu node. */
type TabId = 'users' | 'groups' | 'database' | 'logs';

/** Every tab id, so the deep link and the click handler share one list. */
const TAB_IDS: ReadonlyArray<TabId> = ['users', 'groups', 'database', 'logs'];

/** The menu namespace the identity module registers the tab nodes under. */
const SUBMENU_NAMESPACE = 'identity';

/**
 * Physical collection prefix covering the identity module's storage.
 *
 * The prefix is `module_user_`, not `module_identity_`, because the module was
 * carved out of the former user module and kept its collection names. The
 * traffic module's three `module_user_gsc_*` collections carry the same prefix
 * for the same historical reason, so they are listed here too. Repeated from
 * the backend because frontend code cannot import backend code.
 */
const COLLECTION_PREFIX = 'module_user_';

/** Log service name a module logging through `logger.child({ module: 'identity' })` records under. */
const LOG_SERVICE = 'tronrelic:identity';

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
 * Resolve a submenu node's `?tab=` value, defaulting to `users` so a malformed
 * node never leaves the page on a blank panel.
 *
 * @param url - The clicked node's url, such as `/system/users?tab=logs`.
 * @returns The tab the node stands for.
 */
function tabFromUrl(url: string | undefined): TabId {
    const tab = url?.match(/[?&]tab=([^&]+)/)?.[1];
    return isTabId(tab) ? tab : 'users';
}

/** Props for the client shell. */
interface IUsersAdminClientProps {
    /** Server-fetched submenu nodes (the tab row), already gated for the admin. */
    submenuTree: MenuNodeSerialized[];
    /** Snapshot timestamp of the submenu tree, seeded onto the menu Redux slice. */
    submenuGeneratedAt: string;
    /** The `?tab=` value from the request URL; unknown or absent opens Users. */
    initialTab?: string;
}

/**
 * Users admin shell: header, tab row, and the active panel.
 *
 * @param props - Submenu tree, its timestamp, and the deep-linked tab.
 * @returns The page.
 */
export function UsersAdminClient({ submenuTree, submenuGeneratedAt, initialTab }: IUsersAdminClientProps) {
    const [activeTab, setActiveTab] = useState<TabId>(isTabId(initialTab) ? initialTab : 'users');

    /**
     * Switch to the clicked tab and keep the address bar a real deep link.
     * `MenuNavClient` suppresses navigation when `onItemSelect` is set, so the
     * URL is rewritten in place and a refresh or shared link opens the same tab.
     */
    const handleTabSelect = useCallback((item: MenuNodeSerialized) => {
        const tab = tabFromUrl(item.url);
        setActiveTab(tab);
        window.history.replaceState(null, '', `/system/users?tab=${tab}`);
    }, []);

    return (
        <Page>
            {/* One Stack holds the header, the tab row, and the active panel so
                they sit one stack gap apart instead of the page's wider gap. */}
            <Stack gap="md">
                <PageHeader
                    title="Users"
                    subtitle="Accounts, user groups, and the sign-in records and storage behind them."
                />

                <MenuNavClient
                    namespace={SUBMENU_NAMESPACE}
                    items={submenuTree}
                    generatedAt={submenuGeneratedAt}
                    ariaLabel="Users sections"
                    activeUrl={`/system/users?tab=${activeTab}`}
                    onItemSelect={handleTabSelect}
                />

                {activeTab === 'users' && <UsersMonitor />}
                {activeTab === 'groups' && <GroupsManager />}

                {/* Read-only. These collections hold accounts, sessions, and
                    OAuth grants, and a hand edit can grant the admin group or
                    break every session. Accounts and groups are changed on the
                    Users and Groups tabs, which go through the services. */}
                {activeTab === 'database' && (
                    <CollectionBrowser
                        prefix={COLLECTION_PREFIX}
                        title="Identity Collections"
                        allowEdit={false}
                        allowDelete={false}
                    />
                )}
                {activeTab === 'logs' && <SystemLogsMonitor service={LOG_SERVICE} title="Identity Logs" />}
            </Stack>
        </Page>
    );
}
