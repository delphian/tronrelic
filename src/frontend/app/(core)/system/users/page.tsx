'use client';

import { useState } from 'react';
import { useSystemAuth } from '../../../../features/system';
import { Page } from '../../../../components/layout';
import { Card } from '../../../../components/ui/Card';
import { UsersMonitor, AnalyticsDashboard, ReferralOverview, GscSettings } from '../../../../modules/user';
import styles from './page.module.scss';

/** Tab identifiers for the users admin page. */
type UsersTab = 'users' | 'analytics' | 'referrals' | 'settings';

/**
 * System users administration page with tabbed interface.
 *
 * Three tabs consolidate all user-related admin functionality:
 * - Users: Per-user identity management, wallet links, activity
 * - Analytics: Aggregate traffic sources, engagement, conversion funnel
 * - Referrals: Referral program metrics, top referrers, recent activity
 *
 * Follows the simpler button-tab pattern from /system/pages (no ARIA
 * tablist/tab/tabpanel roles to avoid incomplete implementation).
 */
export default function SystemUsersPage() {
    const { token } = useSystemAuth();
    const [activeTab, setActiveTab] = useState<UsersTab>('users');

    if (!token) {
        return (
            <Page>
                <Card padding="lg">
                    <p>Authentication required</p>
                </Card>
            </Page>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h1 className={styles.title}>Users, Analytics &amp; Referrals</h1>
                <p className={styles.subtitle}>Manage users, analyze traffic, and track referrals</p>
            </div>

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
                    className={activeTab === 'referrals' ? styles.tab__active : styles.tab}
                    onClick={() => setActiveTab('referrals')}
                >
                    Referrals
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
                {activeTab === 'referrals' && <ReferralOverview token={token} />}
                {activeTab === 'settings' && <GscSettings token={token} />}
            </div>
        </div>
    );
}
