'use client';

/**
 * @fileoverview Client shell for /system/account-history.
 *
 * Holds the interactive surface: the live stats snapshot, the in-page tab row,
 * and the six tab panels (tracked accounts, tick activity, ingestion settings,
 * schedules, storage, and logs). The Schedules, Database, and Logs panels are
 * core components scoped to this module rather than panels written for this
 * page, so the authority behind each is the one `/system/scheduler`,
 * `/system/database`, and `/system/logs` use.
 * The tab row is the menu module's Submenu Pattern — a namespaced menu rendered
 * with `MenuNavClient`, not a hand-rolled button array — so it inherits per-user
 * gating, ordering, and live `menu:update` refresh. The server entry
 * (`page.tsx`) fetches that namespace tree SSR-first and passes it in, mirroring
 * how `MenuNavSSR` feeds `MenuNavClient`. Clicking a tab drives local state via
 * `onItemSelect` rather than navigating; `activeUrl` highlights the active tab
 * since the route is identical across them.
 *
 * Ingestion stats stay live off the `account-history:stats` WebSocket nudge — a
 * timestamp-only signal the backend emits after each tick that triggers a
 * refetch over the requireAdmin REST feed. The snapshot itself is never sent
 * over the socket: it carries admin-only data and the broadcast reaches every
 * connected client.
 */

import { useEffect, useState, useCallback } from 'react';
import type { MenuNodeSerialized } from '@/shared';
import { AdminPage, Stack } from '../../../../../../components/layout';
import { Badge } from '../../../../../../components/ui/Badge';
import { ClientTime } from '../../../../../../components/ui/ClientTime';
import { MenuNavClient } from '../../../../../../components/layout/MenuNav/MenuNavClient';
import { getSocket } from '../../../../../../lib/socketClient';
import { ClickHouseTableBrowser, CollectionBrowser } from '../../../../../../modules/database';
import { SystemLogsMonitor } from '../../../../../../modules/logs';
import { SchedulerMonitor, type SchedulerJob } from '../../../../../../modules/scheduler';
import { getStats, type IAccountHistoryStatsView } from '../../../../../../modules/account-history';
import { AccountsTab } from './AccountsTab';
import { ActivityTab } from './ActivityTab';
import { SettingsTab } from './SettingsTab';
import styles from './page.module.scss';

/** The page's six tab ids; the `?tab=` value carried by each submenu node. */
type TabId = 'accounts' | 'activity' | 'settings' | 'schedules' | 'database' | 'logs';

/**
 * Type guard narrowing an arbitrary `?tab=` string to a known TabId, so the
 * deep-link seeding and click routing share one source of truth for valid tabs.
 */
function isTabId(tab: string | undefined): tab is TabId {
    return tab === 'accounts'
        || tab === 'activity'
        || tab === 'settings'
        || tab === 'schedules'
        || tab === 'database'
        || tab === 'logs';
}

/** The menu namespace the module registers the tab nodes under. */
const SUBMENU_NAMESPACE = 'account-history';

/**
 * Physical MongoDB collection prefix covering the module's three control
 * collections: the tracked set, per-account progress, and the pacing settings.
 * The module names them `module_account-history_*` by hand, so scoping the
 * browser to this prefix shows exactly that storage and nothing else.
 */
const COLLECTION_PREFIX = 'module_account-history_';

/**
 * The module's ClickHouse tables: the transaction record, the value ledger,
 * and the two balance snapshot tables. Module tables share no naming prefix,
 * so the browser is scoped by exact name. The names repeat the constants in
 * the module's `database/index.ts`, because frontend code cannot import
 * backend code.
 */
const CLICKHOUSE_TABLES = [
    'account_transactions',
    'account_value_transfers',
    'account_balance_snapshots',
    'account_token_balances'
];

/**
 * Log service name the module's entries are stored under.
 *
 * `AccountHistoryModule` logs through `logger.child({ module: 'account-history' })`,
 * which the log store files as `tronrelic:account-history`, and it passes that
 * logger to each scheduler job so a failed tick is filed here too.
 */
const LOG_SERVICE = 'tronrelic:account-history';

/**
 * Props for the client shell.
 */
interface IAccountHistoryAdminClientProps {
    /** SSR-fetched submenu nodes (the tab row), already gated for the admin. */
    submenuTree: MenuNodeSerialized[];
    /** Snapshot timestamp of the submenu tree, seeded onto the menu Redux slice. */
    submenuGeneratedAt: string;
    /**
     * The `?tab=` value from the request URL, read SSR-first in `page.tsx` so a
     * refreshed, bookmarked, or shared deep link opens on the right panel. An
     * unknown or absent value resolves to `accounts`.
     */
    initialTab?: string;
}

/**
 * Predicate selecting only this module's scheduler jobs for the Schedules tab —
 * the same scheduler authority as /system/scheduler, filtered by name prefix so
 * edits here and there can never drift.
 */
function isAccountHistoryJob(job: SchedulerJob): boolean {
    return job.name.startsWith('account-history:');
}

/**
 * Resolve a submenu node's `?tab=` value to a known TabId, defaulting to
 * `accounts` for an unrecognized or missing value so a malformed node can never
 * leave the page on a blank panel.
 *
 * @param url - The clicked node's url (e.g. `/system/account-history?tab=settings`).
 */
function tabFromUrl(url: string | undefined): TabId {
    const tab = url?.match(/[?&]tab=([^&]+)/)?.[1];
    return isTabId(tab) ? tab : 'accounts';
}

/**
 * Account-history admin client shell.
 *
 * @param props - SSR submenu tree, its timestamp, and the deep-linked initial tab.
 * @returns The page.
 */
export function AccountHistoryAdminClient({ submenuTree, submenuGeneratedAt, initialTab }: IAccountHistoryAdminClientProps) {
    const [activeTab, setActiveTab] = useState<TabId>(isTabId(initialTab) ? initialTab : 'accounts');
    const [stats, setStats] = useState<IAccountHistoryStatsView | null>(null);

    const loadStats = useCallback(async () => {
        try {
            setStats(await getStats());
        } catch {
            /* primary data load failure surfaces on the empty table; leave stats as-is */
        }
    }, []);

    /**
     * Activate the clicked tab and keep its URL a real deep link.
     *
     * `MenuNavClient` suppresses the <Link> navigation when `onItemSelect` is set
     * (it preventDefaults the click), so without this the address bar would never
     * reflect the selected tab and a refresh, bookmark, or shared link would fall
     * back to the Accounts panel. Rewrite the address in place with
     * `history.replaceState` — no server round-trip and no `useSearchParams`
     * Suspense boundary — so the registered `?tab=` URLs become true deep links;
     * `page.tsx` reads that value SSR-first to seed the panel on next load.
     */
    const handleTabSelect = useCallback((item: MenuNodeSerialized) => {
        const tab = tabFromUrl(item.url);
        setActiveTab(tab);
        window.history.replaceState(null, '', `/system/account-history?tab=${tab}`);
    }, []);

    useEffect(() => {
        void loadStats();
    }, [loadStats]);

    // The backend emits a timestamp-only nudge after each ingestion tick (the
    // snapshot carries admin-only data and the broadcast reaches every socket),
    // so refetch the full stats over the requireAdmin REST endpoint on the
    // signal rather than trusting the socket payload — mirroring how the
    // /system/curation page refetches on `curation:changed`.
    useEffect(() => {
        const socket = getSocket();
        const onStats = () => { void loadStats(); };
        socket.on('account-history:stats', onStats);
        return () => { socket.off('account-history:stats', onStats); };
    }, [loadStats]);

    return (
        <AdminPage
            title="Account History"
            subtitle="Track specific TRON accounts, backfill their full transaction history into ClickHouse, and keep completed accounts current with forward sync."
        >
            <p className={styles.intro}>
                Two pull-based passes run on their own schedules, independent of the live block sync. A bounded <strong>backfill</strong>{' '}
                walks each tracked account&apos;s full history newest-first until both TronGrid endpoints exhaust; once an account is
                complete, <strong>forward sync</strong> keeps it current by appending transactions that land afterward. Use the tabs to
                manage the tracked set, tune pacing, and edit the two schedules.
            </p>

            {stats && (
                <div className={styles.summary}>
                    <Badge tone="info">{stats.totals.trackedAccounts} tracked</Badge>
                    <Badge tone="neutral">{stats.totals.rowsIngested.toLocaleString()} rows</Badge>
                    {stats.totals.completeAccounts > 0 && <Badge tone="success">{stats.totals.completeAccounts} complete</Badge>}
                    {stats.totals.catchingUpAccounts > 0 && <Badge tone="warning">{stats.totals.catchingUpAccounts} catching up</Badge>}
                    {stats.totals.failedAccounts > 0 && <Badge tone="danger">{stats.totals.failedAccounts} failed</Badge>}
                    <Badge tone={stats.totals.snapshottedTodayAccounts >= stats.totals.trackedAccounts ? 'success' : 'neutral'}>
                        {stats.totals.snapshottedTodayAccounts}/{stats.totals.trackedAccounts} snapshotted today
                    </Badge>
                    {stats.totals.oldestNewestTimestamp && (
                        <Badge tone="neutral">current to <ClientTime date={stats.totals.oldestNewestTimestamp} format="relative" /></Badge>
                    )}
                </div>
            )}

            <MenuNavClient
                namespace={SUBMENU_NAMESPACE}
                items={submenuTree}
                generatedAt={submenuGeneratedAt}
                ariaLabel="Account history sections"
                activeUrl={`/system/account-history?tab=${activeTab}`}
                onItemSelect={handleTabSelect}
            />

            {activeTab === 'accounts' && <AccountsTab stats={stats} onChanged={loadStats} />}
            {activeTab === 'activity' && <ActivityTab stats={stats} />}
            {activeTab === 'settings' && <SettingsTab />}
            {activeTab === 'schedules' && <SchedulerMonitor jobFilter={isAccountHistoryJob} title="Account History Schedules" />}

            {/* Editing and deletion stay enabled on the MongoDB browser, as on
              * every Database tab, but prefer the Tracked Accounts tab: pausing
              * an account there writes the `paused` flag to both the tracked
              * and the progress document, which an edit to one document here
              * would not. Treat this browser as the escape hatch for a cursor
              * that surface cannot reach. The ClickHouse browser is read-only
              * by design. */}
            {activeTab === 'database' && (
                <Stack gap="lg">
                    <CollectionBrowser prefix={COLLECTION_PREFIX} title="Account History Collections" />
                    <ClickHouseTableBrowser tables={CLICKHOUSE_TABLES} title="Account History Tables" />
                </Stack>
            )}

            {activeTab === 'logs' && <SystemLogsMonitor service={LOG_SERVICE} title="Account History Logs" />}
        </AdminPage>
    );
}
