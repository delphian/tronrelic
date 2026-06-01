'use client';

import { useState } from 'react';
import { useSystemAuth } from '../../../../features/system';
import { UsersMonitor, AnalyticsDashboard, GscSettings, GroupsManager, TrafficDashboard, VisitorAnalytics, PageActivity } from '../../../../modules/user';
import styles from './page.module.scss';

/** Tab identifiers for the users admin page. */
type UsersTab = 'users' | 'analytics' | 'traffic' | 'groups' | 'settings';

/**
 * System users administration page with tabbed interface.
 *
 * Tabs consolidate user-related admin functionality:
 * - Users: Better Auth account directory and group management
 * - Analytics: Aggregate traffic sources, engagement, conversion funnel
 * - Traffic: Capture patterns — anonymous first touches (incl. bots), daily
 *   visitors, anonymous (tid) and registered (user_id) per-page clickstreams,
 *   and bot/geo/path breakdowns
 * - Groups: Admin-defined user groups consumed by plugins for permission gating
 * - Settings: GSC integration and other admin settings
 *
 * Follows the simpler button-tab pattern from /system/pages (no ARIA
 * tablist/tab/tabpanel roles to avoid incomplete implementation).
 */
export default function SystemUsersPage() {
    const { token } = useSystemAuth();
    const [activeTab, setActiveTab] = useState<UsersTab>('users');

    return (
        <div className={styles.container}>
            <div className={styles.tabs}>
                <button
                    type="button"
                    className={activeTab === 'users' ? styles.tab__active : styles.tab}
                    onClick={() => setActiveTab('users')}
                >
                    Users
                </button>
                <button
                    type="button"
                    className={activeTab === 'analytics' ? styles.tab__active : styles.tab}
                    onClick={() => setActiveTab('analytics')}
                >
                    Analytics
                </button>
                <button
                    type="button"
                    className={activeTab === 'traffic' ? styles.tab__active : styles.tab}
                    onClick={() => setActiveTab('traffic')}
                >
                    Traffic
                </button>
                <button
                    type="button"
                    className={activeTab === 'groups' ? styles.tab__active : styles.tab}
                    onClick={() => setActiveTab('groups')}
                >
                    Groups
                </button>
                <button
                    type="button"
                    className={activeTab === 'settings' ? styles.tab__active : styles.tab}
                    onClick={() => setActiveTab('settings')}
                >
                    Settings
                </button>
            </div>

            <div className={styles.content}>
                {activeTab === 'users' && <UsersMonitor token={token} />}
                {activeTab === 'analytics' && <AnalyticsDashboard token={token} />}
                {activeTab === 'traffic' && (
                    <div className={styles.traffic_stack}>
                        <VisitorAnalytics token={token} />
                        <PageActivity token={token} />
                        <TrafficDashboard token={token} />
                    </div>
                )}
                {activeTab === 'groups' && <GroupsManager token={token} />}
                {activeTab === 'settings' && <GscSettings token={token} />}
            </div>
        </div>
    );
}
