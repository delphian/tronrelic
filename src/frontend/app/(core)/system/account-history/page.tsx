'use client';

/**
 * @fileoverview /system/account-history — admin surface for per-account history.
 *
 * Three tabs: tracked accounts (the control surface, with live per-account
 * progress), ingestion settings (pacing), and schedules (the module's scheduler
 * jobs, a filtered view of the one scheduler authority via SchedulerMonitor).
 * Admin-gated by the /system layout; a client component fetching over the
 * cookie-authenticated admin API. Ingestion stats stay live off the
 * `account-history:stats` WebSocket nudge — a timestamp-only signal the backend
 * emits after each tick that triggers a refetch over the requireAdmin REST feed.
 * The snapshot itself is never sent over the socket: it carries admin-only data
 * and the broadcast reaches every connected client.
 */

import { useEffect, useState, useCallback } from 'react';
import { Page, PageHeader } from '../../../../components/layout';
import { Badge } from '../../../../components/ui/Badge';
import { getSocket } from '../../../../lib/socketClient';
import { SchedulerMonitor, type SchedulerJob } from '../../../../modules/scheduler';
import { getStats, type IAccountHistoryStatsView } from '../../../../modules/account-history';
import { AccountsTab } from './AccountsTab';
import { SettingsTab } from './SettingsTab';
import styles from './page.module.scss';

/** The page's three tab ids. */
type TabId = 'accounts' | 'settings' | 'schedules';

/** Tab definitions in display order. */
const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
    { id: 'accounts', label: 'Tracked Accounts' },
    { id: 'settings', label: 'Ingestion Settings' },
    { id: 'schedules', label: 'Schedules' }
];

/**
 * Predicate selecting only this module's scheduler jobs for the Schedules tab —
 * the same scheduler authority as /system/scheduler, filtered by name prefix so
 * edits here and there can never drift.
 *
 * @param job - A scheduler job.
 * @returns True for `account-history:`-prefixed jobs.
 */
function isAccountHistoryJob(job: SchedulerJob): boolean {
    return job.name.startsWith('account-history:');
}

/**
 * Account-history admin page.
 *
 * @returns The page.
 */
export default function AccountHistoryAdminPage() {
    const [activeTab, setActiveTab] = useState<TabId>('accounts');
    const [stats, setStats] = useState<IAccountHistoryStatsView | null>(null);

    const loadStats = useCallback(async () => {
        try {
            setStats(await getStats());
        } catch {
            /* primary data load failure surfaces on the empty table; leave stats as-is */
        }
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
        <Page>
            <PageHeader
                title="Account History"
                subtitle="Track specific TRON accounts and backfill their full transaction history into ClickHouse."
            />

            {stats && (
                <div className={styles.summary}>
                    <Badge tone="info">{stats.totals.trackedAccounts} tracked</Badge>
                    <Badge tone="neutral">{stats.totals.rowsIngested.toLocaleString()} rows</Badge>
                    {stats.totals.completeAccounts > 0 && <Badge tone="success">{stats.totals.completeAccounts} complete</Badge>}
                    {stats.totals.failedAccounts > 0 && <Badge tone="danger">{stats.totals.failedAccounts} failed</Badge>}
                </div>
            )}

            <div className="segmented-control" role="tablist" aria-label="Account history sections">
                {TABS.map((tab) => (
                    <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={activeTab === tab.id}
                        className={activeTab === tab.id ? 'is-active' : undefined}
                        onClick={() => setActiveTab(tab.id)}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            <div className={styles.content}>
                {activeTab === 'accounts' && <AccountsTab stats={stats} onChanged={loadStats} />}
                {activeTab === 'settings' && <SettingsTab />}
                {activeTab === 'schedules' && <SchedulerMonitor jobFilter={isAccountHistoryJob} title="Account History Schedules" />}
            </div>
        </Page>
    );
}
