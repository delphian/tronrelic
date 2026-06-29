'use client';

/**
 * @fileoverview Self-service wallet management panel for the profile page.
 *
 * Renders the account's linked wallets and drives the three signature-proven
 * mutations — link, set-primary, unlink — each of which follows the same
 * challenge → TronLink signature → submit handshake. The list is seeded from
 * SSR data so it paints immediately with no loading flash, and every mutation
 * replaces the list from the authoritative response the backend returns, so
 * the UI never drifts from server truth (e.g. primary promotion after a link).
 */

import { useCallback, useState } from 'react';
import { Wallet, Star, Unlink } from 'lucide-react';
import type { ILinkedWallet } from '@/types';
import { Card } from '../../../../components/ui/Card';
import { Button } from '../../../../components/ui/Button';
import { Badge } from '../../../../components/ui/Badge';
import { Stack } from '../../../../components/layout';
import { ClientTime } from '../../../../components/ui/ClientTime';
import { useToast } from '../../../../components/ui/ToastProvider';
import { connectTronLink, signMessageWithTronLink } from '../../lib/tronLink';
import {
    issueWalletChallenge,
    linkWallet,
    unlinkWallet,
    setPrimaryWallet
} from '../../api/wallets.api';
import styles from './WalletManager.module.scss';

/**
 * Props for {@link WalletManager}.
 */
export interface IWalletManagerProps {
    /**
     * Wallets resolved during SSR. Used as the initial list so the panel
     * renders real content on first paint rather than fetching on mount.
     */
    initialWallets: ILinkedWallet[];
}

/**
 * Wallet management panel.
 *
 * @param props - {@link IWalletManagerProps}.
 */
export function WalletManager({ initialWallets }: IWalletManagerProps) {
    const { push } = useToast();
    const [wallets, setWallets] = useState<ILinkedWallet[]>(initialWallets);
    // A per-action key (e.g. 'link' or 'unlink:T...') marks which control is
    // mid-flight; a single key also disables the others so two signature
    // prompts can't race.
    const [busyKey, setBusyKey] = useState<string | null>(null);

    /**
     * Run one wallet mutation end-to-end with consistent busy-state, toast,
     * and list-refresh handling, so each handler only has to express the
     * challenge/sign/submit specifics.
     *
     * @param key - Stable identifier for the control being actioned.
     * @param run - The mutation; resolves to the authoritative wallet list.
     * @param successTitle - Toast title shown when the mutation succeeds.
     */
    const applyMutation = useCallback(
        async (key: string, run: () => Promise<ILinkedWallet[]>, successTitle: string): Promise<void> => {
            setBusyKey(key);
            try {
                const updated = await run();
                setWallets(updated);
                push({ tone: 'success', title: successTitle });
            } catch (error) {
                push({
                    tone: 'danger',
                    title: 'Wallet action failed',
                    description: error instanceof Error ? error.message : String(error)
                });
            } finally {
                setBusyKey(null);
            }
        },
        [push]
    );

    /**
     * Link the wallet currently active in TronLink. The address must be known
     * before the challenge is minted (the challenge is address-bound), so this
     * connects first, then requests, signs, and submits.
     */
    const handleLink = useCallback((): void => {
        void applyMutation(
            'link',
            async () => {
                const address = await connectTronLink();
                const challenge = await issueWalletChallenge('link', address);
                const { signature } = await signMessageWithTronLink(challenge.message);
                return linkWallet(address, { message: challenge.message, signature, nonce: challenge.nonce });
            },
            'Wallet linked'
        );
    }, [applyMutation]);

    /**
     * Promote an already-linked wallet to primary. The signer must have this
     * wallet active in TronLink or the backend rejects the signature.
     *
     * @param address - The wallet to promote.
     */
    const handleSetPrimary = useCallback(
        (address: string): void => {
            void applyMutation(
                `primary:${address}`,
                async () => {
                    const challenge = await issueWalletChallenge('set-primary', address);
                    const { signature } = await signMessageWithTronLink(challenge.message);
                    return setPrimaryWallet(address, { message: challenge.message, signature, nonce: challenge.nonce });
                },
                'Primary wallet updated'
            );
        },
        [applyMutation]
    );

    /**
     * Detach a wallet from the account after a fresh signature proves control.
     *
     * @param address - The wallet to unlink.
     */
    const handleUnlink = useCallback(
        (address: string): void => {
            void applyMutation(
                `unlink:${address}`,
                async () => {
                    const challenge = await issueWalletChallenge('unlink', address);
                    const { signature } = await signMessageWithTronLink(challenge.message);
                    return unlinkWallet(address, { message: challenge.message, signature, nonce: challenge.nonce });
                },
                'Wallet unlinked'
            );
        },
        [applyMutation]
    );

    const busy = busyKey !== null;

    return (
        <Card>
            <Stack gap="md">
                <div className={styles.header}>
                    <p className="text-muted">
                        Link a TRON wallet by signing a one-time challenge in TronLink. Linking proves you
                        control the address — no transaction or fee.
                    </p>
                    <Button
                        variant="primary"
                        size="sm"
                        icon={<Wallet size={18} aria-hidden />}
                        onClick={handleLink}
                        loading={busyKey === 'link'}
                        disabled={busy}
                    >
                        Link a wallet
                    </Button>
                </div>

                {wallets.length === 0 ? (
                    <p className="text-muted">No wallets linked yet.</p>
                ) : (
                    <ul className={`list--plain ${styles.list}`}>
                        {wallets.map((wallet) => (
                            <li key={wallet.address} className={styles.row}>
                                <div className={styles.identity}>
                                    <span className={styles.address}>{wallet.address}</span>
                                    <span className={styles.meta}>
                                        Linked <ClientTime date={wallet.linkedAt} format="date" />
                                    </span>
                                </div>
                                <div className={styles.actions}>
                                    {wallet.isPrimary ? (
                                        <Badge tone="success">
                                            <Star size={14} aria-hidden /> Primary
                                        </Badge>
                                    ) : (
                                        <Button
                                            variant="secondary"
                                            size="xs"
                                            icon={<Star size={14} aria-hidden />}
                                            onClick={() => handleSetPrimary(wallet.address)}
                                            loading={busyKey === `primary:${wallet.address}`}
                                            disabled={busy}
                                        >
                                            Make primary
                                        </Button>
                                    )}
                                    <Button
                                        variant="danger"
                                        size="xs"
                                        icon={<Unlink size={14} aria-hidden />}
                                        onClick={() => handleUnlink(wallet.address)}
                                        loading={busyKey === `unlink:${wallet.address}`}
                                        disabled={busy}
                                    >
                                        Unlink
                                    </Button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </Stack>
        </Card>
    );
}
