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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Wallet, Star, Unlink, History } from 'lucide-react';
import type { IAccountIngestionProgress, ILinkedWallet } from '@/types';
import { Card } from '../../../../components/ui/Card';
import { Button } from '../../../../components/ui/Button';
import { Badge } from '../../../../components/ui/Badge';
import { Tooltip } from '../../../../components/ui/Tooltip';
import { Stack } from '../../../../components/layout';
import { ClientTime } from '../../../../components/ui/ClientTime';
import { useToast } from '../../../../components/ui/ToastProvider';
import { getSocket } from '../../../../lib/socketClient';
import { connectTronLink, signMessageWithTronLink } from '../../lib/tronLink';
import {
    issueWalletChallenge,
    linkWallet,
    unlinkWallet,
    setPrimaryWallet,
    fetchWalletHistoryProgress
} from '../../api/wallets.api';
import styles from './WalletManager.module.scss';

/**
 * Global WebSocket nudge the account-history module broadcasts after each
 * ingestion tick. It carries no progress data — it is a signal to refetch the
 * authoritative per-wallet status, mirroring how the admin stats page reacts.
 */
const HISTORY_STATS_EVENT = 'account-history:stats';

/**
 * Visual presentation for one wallet's history-download status. Centralises the
 * status → (badge tone, label, explanatory tooltip) mapping so the row render
 * stays declarative and the copy lives in one place.
 *
 * @param progress - The wallet's ingestion progress record.
 * @returns The badge tone, short label, and tooltip sentence describing what is
 *   happening with this wallet's history download.
 */
function describeHistoryStatus(
    progress: IAccountIngestionProgress
): { tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger'; label: string; tooltip: string } {
    const rows = progress.rowsIngested.toLocaleString();
    switch (progress.status) {
        case 'queued':
            return {
                tone: 'neutral',
                label: 'History queued',
                tooltip: 'This wallet is enrolled in the account-history program. Its full transaction history is scheduled to download and will begin shortly.'
            };
        case 'running':
            return {
                tone: 'info',
                label: 'Downloading history',
                tooltip: `Downloading this wallet's full transaction history — ${rows} records saved so far.`
            };
        case 'complete':
            return {
                tone: 'success',
                label: 'History downloaded',
                tooltip: `This wallet's full available transaction history has been downloaded (${rows} records).`
            };
        case 'paused':
            return {
                tone: 'neutral',
                label: 'History paused',
                tooltip: 'The history download for this wallet is paused. It will resume automatically.'
            };
        case 'failed':
            return {
                tone: 'danger',
                label: 'History error',
                tooltip: 'The history download for this wallet hit an error. It will retry automatically.'
            };
        default:
            return {
                tone: 'neutral',
                label: 'History',
                tooltip: 'Transaction history download status for this wallet.'
            };
    }
}

/**
 * Props for {@link WalletManager}.
 */
export interface IWalletManagerProps {
    /**
     * Wallets resolved during SSR. Used as the initial list so the panel
     * renders real content on first paint rather than fetching on mount.
     */
    initialWallets: ILinkedWallet[];

    /**
     * Account-history download progress for the account's verified wallets,
     * resolved during SSR. Seeds the per-wallet status badges so they paint with
     * the list (no loading flash); live updates replace it after hydration.
     */
    initialProgress: IAccountIngestionProgress[];
}

/**
 * Wallet management panel.
 *
 * @param props - {@link IWalletManagerProps}.
 */
export function WalletManager({ initialWallets, initialProgress }: IWalletManagerProps) {
    const { push } = useToast();
    const [wallets, setWallets] = useState<ILinkedWallet[]>(initialWallets);
    // Per-wallet history-download progress, seeded from SSR so badges paint with
    // the list. Replaced wholesale on each refetch (server is authoritative).
    const [progress, setProgress] = useState<IAccountIngestionProgress[]>(initialProgress);
    // A per-action key (e.g. 'link' or 'unlink:T...') marks which control is
    // mid-flight; a single key also disables the others so two signature
    // prompts can't race.
    const [busyKey, setBusyKey] = useState<string | null>(null);

    // Index progress by address so each row renders its status in one lookup.
    const progressByAddress = useMemo(
        () => new Map(progress.map((entry) => [entry.address, entry])),
        [progress]
    );

    /**
     * Refetch the caller's wallet history progress and replace local state.
     * Best-effort: a failure leaves the last-known badges in place rather than
     * surfacing an error, since the status is secondary to wallet management.
     */
    const refreshProgress = useCallback(async (): Promise<void> => {
        try {
            const next = await fetchWalletHistoryProgress();
            setProgress(next);
        } catch {
            // Keep the existing badges; progress is non-critical.
        }
    }, []);

    // After hydration, refresh progress whenever the account-history module
    // signals an ingestion tick. The nudge is a global broadcast carrying no
    // payload, so the handler refetches the authoritative, ownership-scoped
    // status. Mirrors the admin stats page's nudge-and-refetch pattern.
    useEffect(() => {
        const socket = getSocket();
        const handler = (): void => {
            void refreshProgress();
        };
        socket.on(HISTORY_STATS_EVENT, handler);
        return () => {
            socket.off(HISTORY_STATS_EVENT, handler);
        };
    }, [refreshProgress]);

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
                // A link enrolls the wallet into account-history (a queued
                // progress record appears) and an unlink/promote can change the
                // visible set, so pull the fresh status rather than wait for the
                // next ingestion-tick nudge.
                void refreshProgress();
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
        [push, refreshProgress]
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
                // signMessageWithTronLink re-reads the active address at sign time, so the
                // user can switch TronLink accounts after the address-bound challenge is
                // minted. That signature recovers to the wrong signer, which burns the nonce
                // and fails on the backend with a confusing error, so reject the switch here.
                const { address: signer, signature } = await signMessageWithTronLink(challenge.message);
                if (signer !== address) {
                    throw new Error('TronLink account changed during signing. Retry to link the active wallet.');
                }
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
                    // The challenge is bound to the target address and the backend
                    // rejects a signature from any other signer, so confirm TronLink
                    // is on the target before minting the challenge — otherwise the
                    // user signs with the wrong wallet, burns the nonce, and the
                    // submit fails with a confusing error.
                    const active = await connectTronLink();
                    if (active !== address) {
                        throw new Error(`Switch TronLink to ${address} to make it primary, then retry.`);
                    }
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
     * The signer must have this wallet active in TronLink or the backend
     * rejects the signature.
     *
     * @param address - The wallet to unlink.
     */
    const handleUnlink = useCallback(
        (address: string): void => {
            void applyMutation(
                `unlink:${address}`,
                async () => {
                    // The challenge is bound to the target address and the backend
                    // rejects a signature from any other signer, so confirm TronLink
                    // is on the target before minting the challenge — otherwise the
                    // user signs with the wrong wallet, burns the nonce, and the
                    // submit fails with a confusing error.
                    const active = await connectTronLink();
                    if (active !== address) {
                        throw new Error(`Switch TronLink to ${address} to unlink it, then retry.`);
                    }
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
                        {wallets.map((wallet) => {
                            const walletProgress = progressByAddress.get(wallet.address);
                            const status = walletProgress ? describeHistoryStatus(walletProgress) : null;
                            return (
                            <li key={wallet.address} className={styles.row}>
                                <div className={styles.identity}>
                                    <span className={styles.address}>{wallet.address}</span>
                                    <span className={styles.meta}>
                                        Linked <ClientTime date={wallet.linkedAt} format="date" />
                                    </span>
                                    {status && (
                                        <span className={styles.history}>
                                            <Tooltip content={status.tooltip}>
                                                <Badge tone={status.tone}>
                                                    <History size={14} aria-hidden /> {status.label}
                                                </Badge>
                                            </Tooltip>
                                        </span>
                                    )}
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
                            );
                        })}
                    </ul>
                )}
            </Stack>
        </Card>
    );
}
