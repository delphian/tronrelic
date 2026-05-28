'use client';

/**
 * @fileoverview Logged-in user menu body for the global modal portal.
 *
 * Opened by WalletButton's logged-in branch via `useModal()`. Shows
 * the visitor's BA identity, hosts the legacy TronLink wallet flow
 * (Phase 3 keeps it reachable from here even though the header no
 * longer drives state from wallet presence), and provides sign-out.
 *
 * Phase 4 will replace this with a proper anchored dropdown popover.
 * Keeping the body in a modal for Phase 3 means we lean on the
 * already-built ModalProvider instead of introducing portal/popover
 * machinery purely to deliver login affordances.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, LogOut, ShieldCheck, Wallet } from 'lucide-react';
import { Button } from '../../../../components/ui/Button';
import { useToast } from '../../../../components/ui/ToastProvider';
import { signOut } from '../../lib/auth-client';
import { useWallet } from '../../hooks/useWallet';
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
     * implies "I'm done here" (sign-out completed, navigated to
     * profile). The host (WalletButton) closes the modal in response.
     */
    onClose: () => void;
}

/**
 * Profile menu body — identity, sign-out, wallet actions.
 *
 * @param props - {@link IProfileMenuProps}.
 */
export function ProfileMenu({ session, onClose }: IProfileMenuProps) {
    const router = useRouter();
    const { push } = useToast();
    const wallet = useWallet();
    const [signingOut, setSigningOut] = useState(false);
    const [walletWorking, setWalletWorking] = useState(false);

    // useWallet().connect()/verify() never throw — they catch internally
    // and dispatch connectionError to Redux. Surface that here so a
    // missing/locked/rejected TronLink prompt isn't a silent no-op once
    // the spinner stops (the wallet flow's only error channel).
    useEffect(() => {
        if (!wallet.connectionError) {
            return;
        }
        const isNotInstalled = wallet.connectionError.includes('not detected');
        push({
            tone: 'warning',
            title: 'Wallet Connection',
            description: wallet.connectionError,
            ...(isNotInstalled && {
                actionLabel: 'Get TronLink',
                onAction: () => window.open('https://www.tronlink.org/', '_blank')
            })
        });
    }, [wallet.connectionError, push]);

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

    const handleWalletConnect = useCallback(async () => {
        setWalletWorking(true);
        try {
            await wallet.connect();
        } catch (error) {
            push({
                tone: 'warning',
                title: 'Wallet connect failed',
                description: error instanceof Error ? error.message : String(error)
            });
        } finally {
            setWalletWorking(false);
        }
    }, [push, wallet]);

    const handleWalletVerify = useCallback(async () => {
        setWalletWorking(true);
        try {
            await wallet.connect();
            const verified = await wallet.verify();
            if (verified) {
                push({ tone: 'success', title: 'Wallet verified' });
            }
        } finally {
            setWalletWorking(false);
        }
    }, [push, wallet]);

    const handleViewProfile = useCallback(() => {
        if (wallet.address) {
            router.push(`/u/${wallet.address}`);
            onClose();
        }
    }, [onClose, router, wallet.address]);

    const user = session?.user;
    const identityLabel = user?.email || user?.name || (user?.id ? `Account ${user.id.slice(0, 8)}` : 'Account');

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
                {wallet.address && wallet.isVerified ? (
                    <Button variant="secondary" onClick={handleViewProfile} disabled={walletWorking}>
                        <ShieldCheck size={16} aria-hidden /> View profile ({truncateAddress(wallet.address)})
                    </Button>
                ) : wallet.address ? (
                    <Button variant="secondary" onClick={handleWalletVerify} loading={walletWorking}>
                        <AlertCircle size={16} aria-hidden /> Verify {truncateAddress(wallet.address)}
                    </Button>
                ) : (
                    <Button variant="secondary" onClick={handleWalletConnect} loading={walletWorking}>
                        <Wallet size={16} aria-hidden /> Connect TronLink wallet
                    </Button>
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
