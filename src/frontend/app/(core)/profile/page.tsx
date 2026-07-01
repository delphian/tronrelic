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
import type { MenuNodeSerialized } from '@/shared';
import type { IAccountIngestionProgress, ILinkedWallet, IPortfolioSummary } from '@/types';
import { getServerSideApiUrlWithPath } from '../../../lib/api-url';
import { getServerSession } from '../../../modules/user/lib/session-server';
import { Page, PageHeader } from '../../../components/layout';
import { ProfileView } from '../../../modules/user/components/ProfileView';

export const metadata: Metadata = {
    title: 'Profile'
};

/**
 * Namespace holding the profile hub's tab nodes (Profile, Wallets), registered
 * by the identity module. Kept out of `main` so the tabs never appear in the
 * global nav — only this page's `MenuNavClient` reads it.
 */
const SUBMENU_NAMESPACE = 'profile';

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
 * Fetch the account-history download progress for the signed-in account's own
 * verified wallets during SSR, so the wallet panel paints each wallet's status
 * with no loading flash. Forwards the session cookie for ownership scoping and
 * degrades to an empty list on any failure — the panel then simply shows no
 * status badges rather than breaking the page.
 *
 * @param apiUrl - The resolved backend API base (already includes `/api`).
 * @returns Progress for the caller's tracked wallets, or an empty array on failure.
 */
async function fetchInitialProgress(apiUrl: string): Promise<IAccountIngestionProgress[]> {
    let progress: IAccountIngestionProgress[] = [];
    try {
        const reqHeaders = await headers();
        const cookie = reqHeaders.get('cookie');
        if (cookie) {
            const response = await fetch(`${apiUrl}/account-history/me/progress`, {
                headers: { Cookie: cookie },
                cache: 'no-store'
            });
            if (response.ok) {
                const data = await response.json();
                progress = Array.isArray(data?.progress) ? data.progress : [];
            }
        }
    } catch {
        progress = [];
    }
    return progress;
}

/**
 * Fetch the signed-in account's aggregate portfolio summary during SSR so the
 * Wallets-tab landing hero paints net worth immediately with no skeleton flash.
 * The wallet panel is always mounted (the tabs toggle visibility, they don't
 * unmount), so this valuation is computed on every profile load regardless —
 * resolving it here simply moves that single compute-on-read to the server and
 * lets the hero skip its client fetch. Forwards the session cookie for ownership
 * scoping and degrades to null on any failure (no cookie, no snapshot yet, error)
 * — the hero then falls back to a client fetch rather than breaking the page.
 *
 * @param apiUrl - The resolved backend API base (already includes `/api`).
 * @returns The aggregate portfolio summary, or null on any failure.
 */
async function fetchInitialPortfolio(apiUrl: string): Promise<IPortfolioSummary | null> {
    try {
        const reqHeaders = await headers();
        const cookie = reqHeaders.get('cookie');
        if (!cookie) {
            return null;
        }
        const response = await fetch(`${apiUrl}/valuation/me/portfolio`, {
            headers: { Cookie: cookie },
            cache: 'no-store'
        });
        if (!response.ok) {
            return null;
        }
        const data = await response.json();
        return data?.summary ?? null;
    } catch {
        return null;
    }
}

/**
 * Fetch the profile hub's tab row (the `profile` menu namespace) during SSR so
 * the submenu paints with the page instead of after a client round-trip. The
 * nodes carry no gate, but the cookie is forwarded for parity with other
 * Submenu Pattern fetches and to keep behaviour identical if a gate is added
 * later. On any failure it degrades to an empty tree — the page still renders,
 * just without the tab row until a live `menu:update` refetch repopulates it.
 *
 * @param apiUrl - The resolved backend API base (already includes `/api`).
 * @returns The namespace root nodes and the tree snapshot timestamp.
 */
async function fetchSubmenu(apiUrl: string): Promise<{ roots: MenuNodeSerialized[]; generatedAt: string }> {
    const fallback = { roots: [] as MenuNodeSerialized[], generatedAt: new Date().toISOString() };
    try {
        const reqHeaders = await headers();
        const cookie = reqHeaders.get('cookie');
        const response = await fetch(`${apiUrl}/menu?namespace=${SUBMENU_NAMESPACE}`, {
            cache: 'no-store',
            headers: cookie ? { Cookie: cookie } : undefined
        });
        if (!response.ok) {
            return fallback;
        }
        const data = await response.json() as { tree?: { roots?: MenuNodeSerialized[]; generatedAt?: string } };
        return {
            roots: data.tree?.roots ?? [],
            generatedAt: data.tree?.generatedAt ?? fallback.generatedAt
        };
    } catch {
        return fallback;
    }
}

/**
 * Profile page server component.
 *
 * @param props - Next.js route props.
 * @param props.searchParams - The `?tab=` deep link (a Promise in Next.js 15+),
 *   read SSR-first to seed the initially active tab so a refreshed, bookmarked,
 *   or shared link opens on the selected panel instead of falling back to Profile.
 * @returns The SSR-rendered hub for a logged-in visitor, or null to defer to
 *   the route's sign-in gate when there is no session.
 */
export default async function ProfilePage({
    searchParams
}: {
    searchParams: Promise<{ tab?: string }>;
}) {
    const session = await getServerSession();
    if (!session) {
        return null;
    }

    const apiUrl = getServerSideApiUrlWithPath();
    const [initialWallets, initialProgress, initialPortfolio, submenu] = await Promise.all([
        fetchInitialWallets(apiUrl),
        fetchInitialProgress(apiUrl),
        fetchInitialPortfolio(apiUrl),
        fetchSubmenu(apiUrl)
    ]);
    const { tab } = await searchParams;

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
                initialProgress={initialProgress}
                initialPortfolio={initialPortfolio}
                submenuTree={submenu.roots}
                submenuGeneratedAt={submenu.generatedAt}
                initialTab={tab}
            />
        </Page>
    );
}
