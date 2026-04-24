'use client';

import { useSystemAuth } from '../../contexts/SystemAuthContext';
import styles from './LogoutNavItem.module.scss';

/**
 * Nav-tab styled logout control for the system admin navigation.
 *
 * Renders as a regular menu tab so Priority+ overflow handling collapses it
 * into the "More" menu when space runs out, while preserving the SystemAuth
 * logout side-effect (clears admin token, resets auth state).
 */
export function LogoutNavItem() {
    const { logout } = useSystemAuth();

    return (
        <button
            type="button"
            className={styles.tab}
            onClick={logout}
            aria-label="Logout from system dashboard"
        >
            Logout
        </button>
    );
}
