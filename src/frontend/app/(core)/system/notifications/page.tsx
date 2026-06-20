'use client';

/**
 * @fileoverview /system/notifications — the notification administration page.
 *
 * Four tabs: My Preferences (the admin's own opt-outs), Categories and Channels
 * (the global kill switches), and History (the audit feed). Admin-gated by the
 * /system layout; like the other system pages it is a client component that
 * fetches over the cookie-authenticated admin API.
 */

import { useState } from 'react';
import { Page, PageHeader } from '../../../../components/layout';
import { PreferencesPanel, CategoriesTab, ChannelsTab, HistoryTab } from '../../../../modules/notifications';
import styles from './page.module.scss';

/** The administration tabs. */
type TabId = 'preferences' | 'categories' | 'channels' | 'history';

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
    { id: 'preferences', label: 'My Preferences' },
    { id: 'categories', label: 'Categories' },
    { id: 'channels', label: 'Channels' },
    { id: 'history', label: 'History' }
];

/**
 * Notification administration page.
 *
 * @returns The page.
 */
export default function NotificationsAdminPage() {
    const [activeTab, setActiveTab] = useState<TabId>('preferences');

    return (
        <Page>
            <PageHeader title="Notifications" subtitle="Silence your own notifications, govern categories and channels, and audit every blast." />
            <div className={styles.container}>
                <div className={styles.tabs} role="tablist" aria-label="Notification administration sections">
                    {TABS.map((tab) => (
                        <button
                            key={tab.id}
                            role="tab"
                            aria-selected={activeTab === tab.id}
                            className={activeTab === tab.id ? styles.tab__active : styles.tab}
                            onClick={() => setActiveTab(tab.id)}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                <div className={styles.content}>
                    {activeTab === 'preferences' && <PreferencesPanel />}
                    {activeTab === 'categories' && <CategoriesTab />}
                    {activeTab === 'channels' && <ChannelsTab />}
                    {activeTab === 'history' && <HistoryTab />}
                </div>
            </div>
        </Page>
    );
}
