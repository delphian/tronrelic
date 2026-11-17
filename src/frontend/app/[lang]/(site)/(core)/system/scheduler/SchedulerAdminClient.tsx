'use client';

/**
 * @fileoverview Client shell for /system/scheduler.
 *
 * Holds the in-page tab row and its three panels: every scheduled job on the
 * deployment, the scheduler's own MongoDB storage, and the scheduler's log
 * entries. The tab row is the menu module's Submenu Pattern — a namespaced
 * menu rendered with `MenuNavClient` — and clicking a tab drives local state
 * rather than navigating, with the address bar kept as a real deep link.
 *
 * The Jobs panel is the unscoped `SchedulerMonitor`, the same component module
 * pages embed with a `jobFilter`. The Database and Logs panels are core
 * components scoped to this module, so an operator diagnosing a job that never
 * fired can read its stored config, its execution records, and the
 * scheduler's own entries without leaving the page.
 */

import { useCallback, useState } from 'react';
import type { MenuNodeSerialized } from '@/shared';
import { AdminPage } from '../../../../../../components/layout';
import { MenuNavClient } from '../../../../../../components/layout/MenuNav/MenuNavClient';
import { CollectionBrowser } from '../../../../../../modules/database';
import { SystemLogsMonitor } from '../../../../../../modules/logs';
import { SchedulerMonitor } from '../../../../../../modules/scheduler';

/** The page's tab ids; the `?tab=` value carried by each submenu node. */
type TabId = 'jobs' | 'database' | 'logs';

/** Every tab id, so the deep link and the click handler share one list. */
const TAB_IDS: ReadonlyArray<TabId> = ['jobs', 'database', 'logs'];

/** The menu namespace the scheduler module registers the tab nodes under. */
const SUBMENU_NAMESPACE = 'scheduler';

/**
 * Physical collection prefix covering the scheduler's storage,
 * `scheduler_configs` and `scheduler_executions`. The collections predate the
 * `module_<id>_` convention, and no other collection starts with this prefix.
 * Repeated from the backend module because frontend code cannot import
 * backend code.
 */
const COLLECTION_PREFIX = 'scheduler_';

/**
 * Log service name the scheduler records under. The module logs through
 * `logger.child({ module: 'scheduler' })`, and passes that logger to the
 * scheduler service, so the service's own entries and the runs of jobs no
 * other module owns land here too. A job a module or plugin registered with
 * its own logger is filed under that owner instead, on the owner's Logs tab.
 */
const LOG_SERVICE = 'tronrelic:scheduler';

/** Narrow an arbitrary `?tab=` string to a known tab. */
function isTabId(tab: string | undefined): tab is TabId {
    return TAB_IDS.includes(tab as TabId);
}

/**
 * Resolve a submenu node's `?tab=` value, defaulting to `jobs` so a malformed
 * node never leaves the page on a blank panel.
 *
 * @param url - The clicked node's url, e.g. `/system/scheduler?tab=logs`.
 */
function tabFromUrl(url: string | undefined): TabId {
    const tab = url?.match(/[?&]tab=([^&]+)/)?.[1];
    return isTabId(tab) ? tab : 'jobs';
}

/** Props for the client shell. */
interface ISchedulerAdminClientProps {
    /** Server-fetched submenu nodes (the tab row), already gated for the admin. */
    submenuTree: MenuNodeSerialized[];
    /** Snapshot timestamp of the submenu tree. */
    submenuGeneratedAt: string;
    /** The `?tab=` value from the request URL; unknown or absent opens Jobs. */
    initialTab?: string;
}

/**
 * Scheduler admin shell: header, tab row, and the active panel.
 *
 * @param props - Submenu tree, its timestamp, and the deep-linked tab.
 * @returns The page.
 */
export function SchedulerAdminClient({ submenuTree, submenuGeneratedAt, initialTab }: ISchedulerAdminClientProps) {
    const [activeTab, setActiveTab] = useState<TabId>(isTabId(initialTab) ? initialTab : 'jobs');

    /**
     * Switch to the clicked tab and keep the address bar a real deep link.
     * `MenuNavClient` suppresses navigation when `onItemSelect` is set, so the
     * URL is rewritten in place.
     */
    const handleTabSelect = useCallback((item: MenuNodeSerialized) => {
        const tab = tabFromUrl(item.url);
        setActiveTab(tab);
        window.history.replaceState(null, '', `/system/scheduler?tab=${tab}`);
    }, []);

    return (
        <AdminPage title="Scheduler" subtitle="Every scheduled job, its cron schedule, and its last run.">
            <MenuNavClient
                namespace={SUBMENU_NAMESPACE}
                items={submenuTree}
                generatedAt={submenuGeneratedAt}
                ariaLabel="Scheduler sections"
                activeUrl={`/system/scheduler?tab=${activeTab}`}
                onItemSelect={handleTabSelect}
            />

            {activeTab === 'jobs' && <SchedulerMonitor />}

            {/* Read-only. A running job keeps its schedule and enabled state
              * in memory and reads its stored config only when it is
              * scheduled, so an edit here would not reach the live job and the
              * next change from the Jobs tab would overwrite it. Deleting a
              * live job's config loses its schedule at the next restart, and
              * deleting an execution record removes the run the Jobs tab
              * reports. The Jobs tab is the supported way to change a job, and
              * a plugin's uninstall already removes its own configs. */}
            {activeTab === 'database' && (
                <CollectionBrowser
                    prefix={COLLECTION_PREFIX}
                    title="Scheduler Collections"
                    allowEdit={false}
                    allowDelete={false}
                />
            )}
            {activeTab === 'logs' && <SystemLogsMonitor service={LOG_SERVICE} />}
        </AdminPage>
    );
}
