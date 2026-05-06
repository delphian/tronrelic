'use client';

import { useState } from 'react';
import { useSystemAuth } from '../../../../features/system';
import styles from './page.module.scss';
import { FilesTab } from './tabs/FilesTab';
import { SettingsTab } from './tabs/SettingsTab';

/**
 * Files administration interface.
 *
 * Owns the platform-wide file inventory. The `Files` tab lists, uploads,
 * and deletes inventory rows across every source (admin attachments,
 * plugin outputs). The `Settings` tab manages upload policy: max size,
 * allowed extensions, filename sanitization, and storage provider.
 *
 * Page CRUD lives at `/system/pages`; route-blacklist settings live with
 * it. Anything file-related (size limits, extension whitelist) belongs
 * here so the policy and the service that enforces it stay together.
 */
export default function FilesAdminPage() {
    const { token } = useSystemAuth();
    const [activeTab, setActiveTab] = useState<'files' | 'settings'>('files');

    return (
        <div className={styles.container}>
            <div className={styles.tabs}>
                <button
                    type="button"
                    className={activeTab === 'files' ? styles.tab__active : styles.tab}
                    onClick={() => setActiveTab('files')}
                >
                    Files
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
                {activeTab === 'files' && <FilesTab token={token} />}
                {activeTab === 'settings' && <SettingsTab token={token} />}
            </div>
        </div>
    );
}
