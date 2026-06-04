'use client';

import { useState } from 'react';
import styles from './page.module.css';
import { PagesTab } from './tabs/PagesTab';
import { SettingsTab } from './tabs/SettingsTab';

/**
 * Pages administration interface.
 *
 * Pages-only concerns: page CRUD, markdown editing, and the route
 * blacklist that protects core URLs from being shadowed by custom slugs.
 * File browsing and upload-policy settings live at /system/files.
 */
export default function PagesAdminPage() {
    const [activeTab, setActiveTab] = useState<'pages' | 'settings'>('pages');

    return (
        <div className={styles.container}>
            <div className={styles.tabs}>
                <button
                    className={activeTab === 'pages' ? styles.tabActive : styles.tab}
                    onClick={() => setActiveTab('pages')}
                >
                    Pages
                </button>
                <button
                    className={activeTab === 'settings' ? styles.tabActive : styles.tab}
                    onClick={() => setActiveTab('settings')}
                >
                    Settings
                </button>
            </div>

            <div className={styles.content}>
                {activeTab === 'pages' && <PagesTab />}
                {activeTab === 'settings' && <SettingsTab />}
            </div>
        </div>
    );
}
