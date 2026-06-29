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
import { Card } from '../../../../components/ui/Card';
import { Button } from '../../../../components/ui/Button';
import { Badge } from '../../../../components/ui/Badge';
import { Stack, Section } from '../../../../components/layout';
import { useToast } from '../../../../components/ui/ToastProvider';
import { PreferencesPanel } from '../../../notifications';
import { signOut } from '../../lib/auth-client';
import { WalletManager } from '../WalletManager';
import type { IAccountIngestionProgress, ILinkedWallet } from '@/types';
import styles from './ProfileView.module.scss';

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
export function ProfileView({ identity, initialWallets, initialProgress }: IProfileViewProps) {
    const router = useRouter();
    const { push } = useToast();
    const [signingOut, setSigningOut] = useState(false);

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
                <h2>Wallets</h2>
                <WalletManager initialWallets={initialWallets} initialProgress={initialProgress} />
            </Section>

            <Section gap="sm">
                <h2>Notifications</h2>
                <PreferencesPanel />
            </Section>
        </Stack>
    );
}
