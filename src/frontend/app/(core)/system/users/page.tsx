'use client';

import { useState } from 'react';
import { UsersMonitor, GroupsManager } from '../../../../modules/user';
import styles from './page.module.scss';

/** Tab identifiers for the users admin page. */
type UsersTab = 'users' | 'groups';

/**
 * System users administration page with tabbed interface.
 *
 * Identity-only since the identity/traffic split — traffic analytics, the
 * crawler dashboards, and the GSC integration live at /system/traffic:
 * - Users: Better Auth account directory and group membership
 * - Groups: Admin-defined user groups consumed by plugins for permission gating
 *
 * Follows the simpler button-tab pattern from /system/pages (no ARIA
 * tablist/tab/tabpanel roles to avoid incomplete implementation).
 */
export default function SystemUsersPage() {
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
                    className={activeTab === 'groups' ? styles.tab__active : styles.tab}
                    onClick={() => setActiveTab('groups')}
                >
                    Groups
                </button>
            </div>

            <div className={styles.content}>
                {activeTab === 'users' && <UsersMonitor />}
                {activeTab === 'groups' && <GroupsManager />}
            </div>
        </div>
    );
}
