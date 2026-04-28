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
import { Page, PageHeader, Stack } from '../../../../components/layout';
import { useAppSelector } from '../../../../store/hooks';
import type { ProfileData } from './index';
import { useWallet } from '../../hooks/useWallet';
import { useToast } from '../../../../components/ui/ToastProvider';
import { getRuntimeConfig } from '../../../../lib/runtimeConfig';
import { selectUserId } from '../../slice';
import { ReferralCard } from './ReferralCard';
import { WalletCard } from './WalletCard';
import styles from './Profile.module.scss';

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
    // The owner's UUID is the visitor's own cookie identity, hydrated into
    // Redux by the bootstrap call. The profile payload no longer carries
    // it — see backend `IPublicProfile` for the rationale.
    const userId = useAppSelector(selectUserId);

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
        <Page>
            <PageHeader
                title="My Profile"
                subtitle={`${profile.address.slice(0, 8)}...${profile.address.slice(-6)}`}
            >
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
            </PageHeader>

            <Stack gap="lg">
                <WalletCard />
                {userId && (
                    <ReferralCard
                        userId={userId}
                        siteUrl={getRuntimeConfig().siteUrl}
                    />
                )}
            </Stack>
        </Page>
    );
}
