/**
 * Profile owner view component.
 *
 * Displayed when the visitor owns this profile (cookie UUID matches profile owner).
 * This is the private control panel view - currently a placeholder for future
 * functionality. Includes logout button.
 *
 * Receives profile data as prop from server component (SSR pattern).
 */
'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, Loader2 } from 'lucide-react';
import type { ProfileData } from './ProfilePage';
import { useWallet } from '../../hooks/useWallet';
import { useToast } from '../../../../components/ui/ToastProvider';
import styles from './Profile.module.css';

/**
 * Props for ProfileOwnerView.
 */
interface ProfileOwnerViewProps {
    /** Profile data fetched during SSR */
    profile: ProfileData;
}

/**
 * ProfileOwnerView client component.
 *
 * Renders the owner's control panel view. Currently shows a placeholder
 * indicating this is the owner view with the wallet address.
 *
 * Future functionality will include profile settings, wallet management,
 * and other owner-specific controls. Includes logout button.
 */
export function ProfileOwnerView({ profile }: ProfileOwnerViewProps): JSX.Element {
    const { logout } = useWallet();
    const router = useRouter();
    const { push } = useToast();
    const [isLoggingOut, setIsLoggingOut] = useState(false);

    /**
     * Handle logout button click.
     * Logs out and redirects to home page.
     */
    const handleLogout = useCallback(async () => {
        setIsLoggingOut(true);
        try {
            await logout();
            router.push('/');
        } catch (error) {
            console.error('Logout failed:', error);
            push({
                tone: 'warning',
                title: 'Logout Failed',
                description: 'Unable to log out. Please try again.'
            });
        } finally {
            setIsLoggingOut(false);
        }
    }, [logout, router, push]);

    return (
        <div className="page">
            <section className="page-header">
                <div className={styles.header_row}>
                    <div>
                        <h1 className="page-title">My Profile</h1>
                        <p className="page-subtitle">
                            {profile.address.slice(0, 8)}...{profile.address.slice(-6)}
                        </p>
                    </div>
                    <button
                        className={styles.logout_btn}
                        onClick={handleLogout}
                        disabled={isLoggingOut}
                        aria-label="Log out"
                    >
                        {isLoggingOut ? (
                            <Loader2 size={18} className={styles.spinner} />
                        ) : (
                            <LogOut size={18} />
                        )}
                        <span>Logout</span>
                    </button>
                </div>
            </section>

            <div className={styles.container}>
                <div className={styles.placeholder}>
                    <div className={styles.placeholder_icon}>
                        <svg
                            width="48"
                            height="48"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                            <circle cx="12" cy="7" r="4" />
                        </svg>
                    </div>
                    <h2 className={styles.placeholder_title}>Your Control Panel</h2>
                    <p className={styles.placeholder_text}>
                        This is your private profile view. Profile settings and controls
                        will be available here soon.
                    </p>
                </div>
            </div>
        </div>
    );
}
