'use client';

/**
 * @fileoverview Client-side login gate for the `/profile` route.
 *
 * The profile hub is private — only the signed-in account may see it. This
 * mirrors the admin `SystemAuthGate` pattern but gates on `isLoggedIn` rather
 * than admin-group membership, since a personal profile has no "wrong group"
 * case. Because the Better Auth session is SSR-seeded into the session
 * provider, the gate decides correctly on the very first render with no flash,
 * and signed-out visitors get an inline sign-in affordance instead of the
 * protected content.
 */

import type { ReactNode } from 'react';
import { Page, PageHeader } from '../../../../components/layout';
import { Card } from '../../../../components/ui/Card';
import { useAuthSession } from '../SessionProvider';
import { WalletButton } from '../WalletButton';
import styles from './ProfileAuthGate.module.scss';

/**
 * Props for {@link ProfileAuthGate}.
 */
export interface IProfileAuthGateProps {
    /** The protected profile content rendered once the visitor is logged in. */
    children: ReactNode;
}

/**
 * Gate that reveals its children only to a logged-in visitor.
 *
 * @param props - {@link IProfileAuthGateProps}.
 */
export function ProfileAuthGate({ children }: IProfileAuthGateProps) {
    const { isLoggedIn, isPending } = useAuthSession();

    // Render nothing only in the genuine pending window (cold load with no SSR
    // seed); normally the seeded session resolves this synchronously.
    if (isPending) {
        return null;
    }

    if (!isLoggedIn) {
        return (
            <Page>
                <PageHeader title="Profile" subtitle="Sign in to view and manage your account." />
                <Card>
                    <div className={styles.prompt}>
                        <p className="text-muted">You need to be signed in to access your profile.</p>
                        <WalletButton />
                    </div>
                </Card>
            </Page>
        );
    }

    return <>{children}</>;
}
