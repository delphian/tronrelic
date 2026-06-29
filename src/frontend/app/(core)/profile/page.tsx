/**
 * @fileoverview Private `/profile` page — the SSR entry point for the settings hub.
 *
 * Resolves the Better Auth session and the account's linked wallets on the
 * server so the hub renders with real content and no loading flash, then hands
 * both to the client `ProfileView`. When there is no session this returns
 * nothing and the route's `ProfileAuthGate` shows the sign-in prompt instead —
 * the page never renders identity-bearing markup for an anonymous visitor.
 */

import { headers } from 'next/headers';
import type { Metadata } from 'next';
import type { ILinkedWallet } from '@/types';
import { getServerConfig } from '../../../lib/serverConfig';
import { getServerSession } from '../../../modules/user/lib/session-server';
import { Page, PageHeader } from '../../../components/layout';
import { ProfileView } from '../../../modules/user/components/ProfileView';

export const metadata: Metadata = {
    title: 'Profile'
};

/**
 * Fetch the signed-in account's linked wallets during SSR, forwarding the
 * inbound session cookie so the backend authorises the request. Failures
 * degrade to an empty list — the wallet panel then renders its empty state and
 * the user can still link a wallet — rather than breaking the whole page.
 *
 * @param apiUrl - The resolved backend API base (already includes `/api`).
 * @returns The account's linked wallets, or an empty array on any failure.
 */
async function fetchInitialWallets(apiUrl: string): Promise<ILinkedWallet[]> {
    let wallets: ILinkedWallet[] = [];
    try {
        const reqHeaders = await headers();
        const cookie = reqHeaders.get('cookie');
        if (cookie) {
            const response = await fetch(`${apiUrl}/user/wallets`, {
                headers: { Cookie: cookie },
                cache: 'no-store'
            });
            if (response.ok) {
                const data = await response.json();
                wallets = Array.isArray(data?.wallets) ? data.wallets : [];
            }
        }
    } catch {
        wallets = [];
    }
    return wallets;
}

/**
 * Profile page server component.
 *
 * @returns The SSR-rendered hub for a logged-in visitor, or null to defer to
 *   the route's sign-in gate when there is no session.
 */
export default async function ProfilePage() {
    const session = await getServerSession();
    if (!session) {
        return null;
    }

    const { apiUrl } = await getServerConfig();
    const initialWallets = await fetchInitialWallets(apiUrl);

    return (
        <Page>
            <PageHeader title="Profile" subtitle="Manage your account, wallets, and notifications." />
            <ProfileView
                identity={{
                    id: session.user.id,
                    email: session.user.email,
                    name: session.user.name,
                    emailVerified: session.user.emailVerified
                }}
                initialWallets={initialWallets}
            />
        </Page>
    );
}
