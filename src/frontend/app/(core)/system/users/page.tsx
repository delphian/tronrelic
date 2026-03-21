'use client';

import { useState } from 'react';
import { useSystemAuth } from '../../../../features/system';
import { Page } from '../../../../components/layout';
import { Card } from '../../../../components/ui/Card';
import { UsersMonitor, AnalyticsDashboard, ReferralOverview } from '../../../../modules/user';
import styles from './page.module.scss';

/** Tab identifiers for the users admin page. */
type UsersTab = 'users' | 'analytics' | 'referrals';

/**
 * System users administration page with tabbed interface.
 *
 * Three tabs consolidate all user-related admin functionality:
 * - Users: Per-user identity management, wallet links, activity
 * - Analytics: Aggregate traffic sources, engagement, conversion funnel
 * - Referrals: Referral program metrics, top referrers, recent activity
 *
 * Previously, Analytics was a separate /system/analytics page. It now lives
 * here as a tab for unified navigation.
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
                <h1 className={styles.title}>Users & Analytics</h1>
                <p className={styles.subtitle}>Manage users, analyze traffic, and track referrals</p>
            </div>

            <div className={styles.tabs} role="tablist" aria-label="Users administration">
                <button
                    className={activeTab === 'users' ? styles.tab__active : styles.tab}
                    onClick={() => setActiveTab('users')}
                    role="tab"
                    aria-selected={activeTab === 'users'}
                >
                    Users
                </button>
                <button
                    className={activeTab === 'analytics' ? styles.tab__active : styles.tab}
                    onClick={() => setActiveTab('analytics')}
                    role="tab"
                    aria-selected={activeTab === 'analytics'}
                >
                    Analytics
                </button>
                <button
                    className={activeTab === 'referrals' ? styles.tab__active : styles.tab}
                    onClick={() => setActiveTab('referrals')}
                    role="tab"
                    aria-selected={activeTab === 'referrals'}
                >
                    Referrals
                </button>
            </div>

            <div className={styles.content} role="tabpanel">
                {activeTab === 'users' && <UsersMonitor token={token} />}
                {activeTab === 'analytics' && <AnalyticsDashboard token={token} />}
                {activeTab === 'referrals' && <ReferralOverview token={token} />}
            </div>
        </div>
    );
}
