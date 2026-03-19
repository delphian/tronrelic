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

import { User } from 'lucide-react';
import { Page, PageHeader } from '../../../../components/layout';
import type { ProfileData } from './index';
import styles from './Profile.module.scss';

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
        <Page>
            <PageHeader
                title="Profile"
                subtitle={`${profile.address.slice(0, 8)}...${profile.address.slice(-6)}`}
            />

            <div className={styles.container}>
                <div className={styles.placeholder}>
                    <div className={styles.placeholder_icon}>
                        <User size={48} strokeWidth={1.5} />
                    </div>
                    <h2 className={styles.placeholder_title}>Public Profile</h2>
                    <p className={styles.placeholder_text}>
                        This user&apos;s public profile information will be displayed here.
                    </p>
                </div>
            </div>
        </Page>
    );
}
