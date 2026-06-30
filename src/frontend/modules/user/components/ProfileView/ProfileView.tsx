'use client';

/**
 * @fileoverview Profile hub body — the single home for user-controlled settings.
 *
 * Composes the account identity (with sign-out), the wallet management panel,
 * and notification preferences into one stacked surface. It is the client half
 * of the SSR-first `/profile` page: the server resolves identity and wallets
 * and hands them in as props, so the hub paints real content immediately and
 * only the optional notification preferences load after mount. Sign-out lives
 * here (not in a header dropdown) because the header account button now routes
 * straight to this page.
 */

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, ShieldCheck } from 'lucide-react';
import type { MenuNodeSerialized } from '@/shared';
import { Card } from '../../../../components/ui/Card';
import { Button } from '../../../../components/ui/Button';
import { Badge } from '../../../../components/ui/Badge';
import { Stack, Section } from '../../../../components/layout';
import { MenuNavClient } from '../../../../components/layout/MenuNav/MenuNavClient';
import { useToast } from '../../../../components/ui/ToastProvider';
import { PreferencesPanel } from '../../../notifications';
import { signOut } from '../../lib/auth-client';
import { WalletManager } from '../WalletManager';
import type { IAccountIngestionProgress, ILinkedWallet } from '@/types';
import styles from './ProfileView.module.scss';

/** The hub's tab ids; the `?tab=` value carried by each submenu node. */
type ProfileTabId = 'profile' | 'wallets';

/** The menu namespace the identity module registers the tab nodes under. */
const SUBMENU_NAMESPACE = 'profile';

/**
 * Resolve a submenu node's `?tab=` value (or the SSR `initialTab`) to a known
 * tab id, defaulting to `profile` for an unrecognized or missing value so a
 * malformed node or stale link can never leave the hub on a blank panel.
 *
 * @param value - A `?tab=` query value or a full node url carrying one.
 * @returns The matching tab id.
 */
function resolveTab(value: string | undefined): ProfileTabId {
    const tab = value?.match(/[?&]tab=([^&]+)/)?.[1] ?? value;
    return tab === 'wallets' ? 'wallets' : 'profile';
}

/**
 * The identity fields the hub needs to render. A trimmed projection of the
 * SSR session so the server passes only what the view shows.
 */
export interface IProfileIdentity {
    /** Better Auth user id; the fallback label when no email/name exists. */
    id: string;

    /** Account email, when present. */
    email?: string | null;

    /** Display name, when present. */
    name?: string | null;

    /** Whether the account's email is verified, to show the verified chip. */
    emailVerified?: boolean;
}

/**
 * Props for {@link ProfileView}.
 */
export interface IProfileViewProps {
    /** SSR-resolved identity for the signed-in account. */
    identity: IProfileIdentity;

    /** SSR-resolved linked wallets, seeding the wallet panel. */
    initialWallets: ILinkedWallet[];

    /**
     * SSR-resolved account-history download progress for the account's verified
     * wallets, seeding the per-wallet status badges so they paint without a flash.
     */
    initialProgress: IAccountIngestionProgress[];

    /**
     * SSR-fetched tab row nodes (Profile, Wallets) for the hub's submenu. Driving
     * the row through the menu service rather than a hand-rolled button array
     * gives it ordering and live `menu:update` refresh, and lets a plugin
     * contribute a tab by registering into the `profile` namespace.
     */
    submenuTree: MenuNodeSerialized[];

    /** Snapshot timestamp of the submenu tree, seeded onto the menu Redux slice. */
    submenuGeneratedAt: string;

    /**
     * The `?tab=` value from the request URL, read SSR-first in `page.tsx` so a
     * refreshed, bookmarked, or shared deep link opens on the right panel. An
     * unknown or absent value resolves to `profile`.
     */
    initialTab?: string;
}

/**
 * Render a human label for the account, preferring email, then name, then a
 * short id prefix so there is always something meaningful to show.
 *
 * @param identity - The account identity projection.
 * @returns A display label for the "Signed in as" line.
 */
function identityLabel(identity: IProfileIdentity): string {
    return identity.email || identity.name || `Account ${identity.id.slice(0, 8)}`;
}

/**
 * Profile hub body.
 *
 * @param props - {@link IProfileViewProps}.
 */
export function ProfileView({
    identity,
    initialWallets,
    initialProgress,
    submenuTree,
    submenuGeneratedAt,
    initialTab
}: IProfileViewProps) {
    const router = useRouter();
    const { push } = useToast();
    const [signingOut, setSigningOut] = useState(false);
    const [activeTab, setActiveTab] = useState<ProfileTabId>(resolveTab(initialTab));

    /**
     * Activate the clicked tab and keep its URL a real deep link.
     *
     * `MenuNavClient` suppresses the <Link> navigation when `onItemSelect` is set,
     * so without this the address bar would never reflect the selected tab and a
     * refresh or shared link would fall back to the Profile panel. Rewrite the
     * address in place with `history.replaceState` — no server round-trip — so the
     * registered `?tab=` URLs become true deep links that `page.tsx` reads
     * SSR-first to seed the panel on next load.
     *
     * @param item - The clicked submenu node, carrying its `?tab=` url.
     */
    const handleTabSelect = useCallback((item: MenuNodeSerialized): void => {
        const tab = resolveTab(item.url);
        setActiveTab(tab);
        window.history.replaceState(null, '', `/profile?tab=${tab}`);
    }, []);

    /**
     * Sign the user out, then refresh so the route's auth gate re-evaluates and
     * shows the signed-out state without a manual reload.
     */
    const handleSignOut = useCallback(async (): Promise<void> => {
        setSigningOut(true);
        try {
            await signOut();
            push({ tone: 'success', title: 'Signed out' });
            router.refresh();
        } catch (error) {
            push({
                tone: 'danger',
                title: 'Sign out failed',
                description: error instanceof Error ? error.message : String(error)
            });
        } finally {
            setSigningOut(false);
        }
    }, [push, router]);

    return (
        <Stack gap="lg">
            <div className={styles.submenu}>
                <MenuNavClient
                    namespace={SUBMENU_NAMESPACE}
                    items={submenuTree}
                    generatedAt={submenuGeneratedAt}
                    ariaLabel="Profile sections"
                    activeUrl={`/profile?tab=${activeTab}`}
                    onItemSelect={handleTabSelect}
                />
            </div>

            {activeTab === 'profile' && (
                <>
                    <Section gap="sm">
                        <h2>Account</h2>
                        <Card>
                            <div className={styles.account}>
                                <div className={styles.identity}>
                                    <span className="text-muted">Signed in as</span>
                                    <strong className={styles.identity_value}>{identityLabel(identity)}</strong>
                                    {identity.emailVerified && (
                                        <Badge tone="success">
                                            <ShieldCheck size={14} aria-hidden /> Email verified
                                        </Badge>
                                    )}
                                </div>
                                <Button
                                    variant="danger"
                                    size="sm"
                                    icon={<LogOut size={18} aria-hidden />}
                                    onClick={handleSignOut}
                                    loading={signingOut}
                                >
                                    Sign out
                                </Button>
                            </div>
                        </Card>
                    </Section>

                    <Section gap="sm">
                        <h2>Notifications</h2>
                        <PreferencesPanel />
                    </Section>
                </>
            )}

            {activeTab === 'wallets' && (
                <Section gap="sm">
                    <WalletManager initialWallets={initialWallets} initialProgress={initialProgress} />
                </Section>
            )}
        </Stack>
    );
}
