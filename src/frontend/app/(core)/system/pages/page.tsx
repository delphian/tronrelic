'use client';

import { useState } from 'react';
import { useSystemAuth } from '../../../../features/system';
import styles from './page.module.css';
import { PagesTab } from './tabs/PagesTab';
import { FilesTab } from './tabs/FilesTab';
import { SettingsTab } from './tabs/SettingsTab';

/**
 * Pages administration interface.
 *
 * Provides tools for creating and managing custom content pages:
 * - Page list with search/filter
 * - Markdown editor with frontmatter
 * - File upload manager
 * - Module settings configuration
 */
export default function PagesAdminPage() {
    const { token } = useSystemAuth();
    const [activeTab, setActiveTab] = useState<'pages' | 'files' | 'settings'>('pages');

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
                    className={activeTab === 'files' ? styles.tabActive : styles.tab}
                    onClick={() => setActiveTab('files')}
                >
                    Files
                </button>
                <button
                    className={activeTab === 'settings' ? styles.tabActive : styles.tab}
                    onClick={() => setActiveTab('settings')}
                >
                    Settings
                </button>
            </div>

            <div className={styles.content}>
                {activeTab === 'pages' && <PagesTab token={token} />}
                {activeTab === 'files' && <FilesTab token={token} />}
                {activeTab === 'settings' && <SettingsTab token={token} />}
            </div>
        </div>
    );
}
