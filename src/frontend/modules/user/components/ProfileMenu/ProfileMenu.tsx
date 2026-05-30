'use client';

/**
 * @fileoverview Logged-in user menu body for the global modal portal.
 *
 * Opened by WalletButton's logged-in branch via `useModal()`. Shows the
 * visitor's Better Auth identity, the linked primary wallet (read-only),
 * and sign-out.
 *
 * The interactive TronLink link/verify flow was retired with the legacy
 * UUID identity system; a Better Auth-keyed wallet management UI is a
 * separate follow-up (see PLAN-better-auth-phase-6 "Out of Scope"). The
 * primary wallet shown here comes from the BA `primaryWallet` additional
 * field, maintained by the backend WalletService.
 */

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, ShieldCheck, Wallet } from 'lucide-react';
import { Button } from '../../../../components/ui/Button';
import { useToast } from '../../../../components/ui/ToastProvider';
import { signOut } from '../../lib/auth-client';
import type { ISSRSession } from '../../lib/session-server';
import styles from './ProfileMenu.module.scss';

/**
 * Truncate a wallet address for display.
 *
 * @param address - Full TRON address.
 * @returns First-3 / last-3 character form, e.g. `TRS…8Mq`.
 */
function truncateAddress(address: string): string {
    return `${address.slice(0, 3)}…${address.slice(-3)}`;
}

/**
 * Props for the profile menu body.
 */
export interface IProfileMenuProps {
    /**
     * Current BA session — never null inside this component (the
     * WalletButton only opens the modal when a session is present).
     * Typed permissive so callers can hand off the context value
     * without an extra null-narrowing.
     */
    session: ISSRSession | null;

    /**
     * Invoked when the user dismisses the menu via an action that
     * implies "I'm done here" (sign-out completed). The host
     * (WalletButton) closes the modal in response.
     */
    onClose: () => void;
}

/**
 * Profile menu body — identity, primary wallet, sign-out.
 *
 * @param props - {@link IProfileMenuProps}.
 */
export function ProfileMenu({ session, onClose }: IProfileMenuProps) {
    const router = useRouter();
    const { push } = useToast();
    const [signingOut, setSigningOut] = useState(false);

    const handleSignOut = useCallback(async () => {
        setSigningOut(true);
        try {
            await signOut();
            push({ tone: 'success', title: 'Signed out' });
            router.refresh();
            onClose();
        } catch (error) {
            push({
                tone: 'danger',
                title: 'Sign out failed',
                description: error instanceof Error ? error.message : String(error)
            });
        } finally {
            setSigningOut(false);
        }
    }, [onClose, push, router]);

    const user = session?.user;
    const identityLabel = user?.email || user?.name || (user?.id ? `Account ${user.id.slice(0, 8)}` : 'Account');
    const primaryWallet = user?.primaryWallet;

    return (
        <div className={styles.menu}>
            <div className={styles.identity}>
                <span className={styles.identity_label}>Signed in as</span>
                <strong className={styles.identity_value}>{identityLabel}</strong>
                {user?.emailVerified && (
                    <span className={styles.verified_chip}>
                        <ShieldCheck size={14} aria-hidden /> Email verified
                    </span>
                )}
            </div>

            <section className={styles.section} aria-labelledby="profile-menu-wallet">
                <h3 id="profile-menu-wallet" className={styles.section_title}>
                    Wallet
                </h3>
                {primaryWallet ? (
                    <span className={styles.verified_chip}>
                        <Wallet size={14} aria-hidden /> {truncateAddress(primaryWallet)}
                    </span>
                ) : (
                    <p className={styles.section_hint}>No wallet linked yet.</p>
                )}
                <p className={styles.section_hint}>Wallet linking gets fully wired to your account in an upcoming release.</p>
            </section>

            <div className={styles.actions}>
                <Button variant="ghost" onClick={onClose} disabled={signingOut}>
                    Close
                </Button>
                <Button variant="danger" onClick={handleSignOut} loading={signingOut}>
                    <LogOut size={16} aria-hidden /> Sign out
                </Button>
            </div>
        </div>
    );
}
