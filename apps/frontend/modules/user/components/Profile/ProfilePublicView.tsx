/**
 * Profile public view component.
 *
 * Displayed when a visitor views someone else's profile (or when anonymous).
 * This is the public-facing profile view - currently a placeholder for future
 * functionality.
 *
 * Receives profile data as prop from server component (SSR pattern).
 */
'use client';

import type { ProfileData } from './index';
import styles from './Profile.module.css';

/**
 * Props for ProfilePublicView.
 */
interface ProfilePublicViewProps {
    /** Profile data fetched during SSR */
    profile: ProfileData;
}

/**
 * ProfilePublicView client component.
 *
 * Renders the public profile view visible to all visitors. Currently shows
 * a placeholder indicating this is a public profile with the wallet address.
 *
 * Future functionality will include public stats, activity history,
 * and other publicly visible profile information.
 */
export function ProfilePublicView({ profile }: ProfilePublicViewProps): JSX.Element {
    return (
        <div className="page">
            <section className="page-header">
                <h1 className="page-title">Profile</h1>
                <p className="page-subtitle">
                    {profile.address.slice(0, 8)}...{profile.address.slice(-6)}
                </p>
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
                    <h2 className={styles.placeholder_title}>Public Profile</h2>
                    <p className={styles.placeholder_text}>
                        This user&apos;s public profile information will be displayed here.
                    </p>
                </div>
            </div>
        </div>
    );
}
