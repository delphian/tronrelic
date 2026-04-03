/**
 * WalletCard Component
 *
 * Displays and manages linked wallets on the profile owner view.
 * Shows each wallet's address, verification status, and primary designation.
 * Supports setting a wallet as primary and unlinking wallets (with signature).
 *
 * Reads wallet data from Redux state populated by UserIdentityProvider,
 * so no additional SSR data fetch is needed.
 */

'use client';

import { useState, useCallback } from 'react';
import { Wallet, ShieldCheck, Shield, Star, Trash2, Loader2 } from 'lucide-react';
import { Stack } from '../../../../../components/layout';
import { useAppSelector, useAppDispatch } from '../../../../../store/hooks';
import { selectWallets, selectUserId, setPrimaryWalletThunk, unlinkWalletThunk } from '../../../slice';
import { useWallet } from '../../../hooks/useWallet';
import { useToast } from '../../../../../components/ui/ToastProvider';
import type { IWalletLink } from '../../../types';
import styles from './WalletCard.module.scss';

/**
 * Truncate a TRON address for display.
 *
 * @param address - Full TRON address
 * @returns Truncated address (first 8 + last 6 chars)
 */
function truncateAddress(address: string): string {
    return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

/**
 * WalletCard displays and manages linked wallets for the profile owner.
 *
 * Reads wallet list from Redux (populated during identity initialization).
 * Provides set-primary and unlink actions. Unlink requires a TronLink
 * signature to prove wallet ownership before removal.
 */
export function WalletCard(): JSX.Element {
    const dispatch = useAppDispatch();
    const wallets = useAppSelector(selectWallets);
    const userId = useAppSelector(selectUserId);
    const { signMessage, verify } = useWallet();
    const { push } = useToast();

    const [pendingAction, setPendingAction] = useState<string | null>(null);

    /**
     * Set a wallet as primary.
     * No signature required — cookie validation is sufficient.
     */
    const handleSetPrimary = useCallback(async (address: string) => {
        if (!userId) return;

        setPendingAction(`primary:${address}`);
        try {
            await dispatch(setPrimaryWalletThunk({ userId, address })).unwrap();
            push({ tone: 'success', title: 'Primary wallet updated' });
        } catch {
            push({ tone: 'warning', title: 'Failed to set primary wallet' });
        } finally {
            setPendingAction(null);
        }
    }, [dispatch, userId, push]);

    /**
     * Unlink a wallet. Requires TronLink signature to prove ownership.
     */
    const handleUnlink = useCallback(async (address: string) => {
        if (!userId) return;

        setPendingAction(`unlink:${address}`);
        try {
            const timestamp = Date.now();
            const message = `Unlink wallet ${address} from TronRelic identity ${userId} at ${timestamp}`;
            const signature = await signMessage(message);

            await dispatch(unlinkWalletThunk({
                userId,
                address,
                message,
                signature
            })).unwrap();

            push({ tone: 'success', title: 'Wallet unlinked' });
        } catch {
            push({ tone: 'warning', title: 'Failed to unlink wallet', description: 'Signature may have been rejected.' });
        } finally {
            setPendingAction(null);
        }
    }, [dispatch, userId, signMessage, push]);

    /**
     * Verify an unverified wallet via TronLink signature.
     */
    const handleVerify = useCallback(async () => {
        setPendingAction('verify');
        try {
            await verify();
            push({ tone: 'success', title: 'Wallet verified' });
        } catch {
            push({ tone: 'warning', title: 'Verification failed' });
        } finally {
            setPendingAction(null);
        }
    }, [verify, push]);

    /**
     * Render a single wallet row with status badges and actions.
     */
    const renderWalletRow = useCallback((wallet: IWalletLink) => {
        const isPending = pendingAction?.endsWith(wallet.address) || false;
        const isVerifyPending = pendingAction === 'verify';

        return (
            <div key={wallet.address} className={styles.wallet_row}>
                <div className={styles.wallet_info}>
                    <span className={styles.wallet_address}>{truncateAddress(wallet.address)}</span>
                    <div className={styles.wallet_badges}>
                        {wallet.verified ? (
                            <span className={`badge badge--success ${styles.badge}`}>
                                <ShieldCheck size={12} />
                                Verified
                            </span>
                        ) : (
                            <span className={`badge badge--neutral ${styles.badge}`}>
                                <Shield size={12} />
                                Unverified
                            </span>
                        )}
                        {wallet.isPrimary && (
                            <span className={`badge badge--neutral ${styles.badge}`}>
                                <Star size={12} />
                                Primary
                            </span>
                        )}
                    </div>
                </div>
                <div className={styles.wallet_actions}>
                    {!wallet.verified && (
                        <button
                            className={`btn btn--primary btn--sm ${styles.action_btn}`}
                            onClick={handleVerify}
                            disabled={isVerifyPending}
                            aria-label={`Verify wallet ${truncateAddress(wallet.address)}`}
                        >
                            {isVerifyPending ? <Loader2 size={14} className={styles.spinner} /> : <ShieldCheck size={14} />}
                            Verify
                        </button>
                    )}
                    {!wallet.isPrimary && wallet.verified && (
                        <button
                            className={`btn btn--secondary btn--sm ${styles.action_btn}`}
                            onClick={() => handleSetPrimary(wallet.address)}
                            disabled={isPending}
                            aria-label={`Set ${truncateAddress(wallet.address)} as primary`}
                        >
                            {pendingAction === `primary:${wallet.address}`
                                ? <Loader2 size={14} className={styles.spinner} />
                                : <Star size={14} />}
                            Set Primary
                        </button>
                    )}
                    <button
                        className={`btn btn--ghost btn--sm ${styles.action_btn} ${styles.action_btn__danger}`}
                        onClick={() => handleUnlink(wallet.address)}
                        disabled={isPending}
                        aria-label={`Unlink wallet ${truncateAddress(wallet.address)}`}
                    >
                        {pendingAction === `unlink:${wallet.address}`
                            ? <Loader2 size={14} className={styles.spinner} />
                            : <Trash2 size={14} />}
                        Unlink
                    </button>
                </div>
            </div>
        );
    }, [pendingAction, handleSetPrimary, handleUnlink, handleVerify]);

    if (wallets.length === 0) {
        return (
            <div className={`surface surface--padding-md ${styles.card}`}>
                <div className={styles.empty_state}>
                    No wallets linked yet. Connect a wallet to get started.
                </div>
            </div>
        );
    }

    return (
        <div className={`surface surface--padding-md ${styles.card}`}>
            <Stack gap="md">
                <h3 className={styles.card_title}>
                    <Wallet size={16} className={styles.title_icon} />
                    Linked Wallets
                </h3>
                <div className={styles.wallet_list}>
                    {wallets.map(renderWalletRow)}
                </div>
            </Stack>
        </div>
    );
}
