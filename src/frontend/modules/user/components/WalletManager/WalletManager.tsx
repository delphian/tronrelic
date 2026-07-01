'use client';

/**
 * @fileoverview Orchestrator for the reformed profile Wallets tab.
 *
 * Portfolio dashboards land on a value view and drill down, so this component
 * leads with a scope switcher (aggregate by default) and a portfolio hero, then
 * offers the per-wallet detail, and finally demotes the rare, destructive wallet
 * management (link / make-primary / unlink) into a collapsed section so a danger
 * button never competes with viewing balances. The list is seeded from SSR data
 * so it paints immediately with no loading flash, and every mutation replaces the
 * list from the authoritative response the backend returns, so the UI never
 * drifts from server truth (e.g. primary promotion after a link).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Wallet } from 'lucide-react';
import type { IAccountIngestionProgress, ILinkedWallet, IPortfolioSummary } from '@/types';
import { Card } from '../../../../components/ui/Card';
import { Button } from '../../../../components/ui/Button';
import { Stack } from '../../../../components/layout';
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
import { fetchAggregatePortfolio } from '../../api/valuation-user.api';
import { WalletDetailPanel, PortfolioPanel } from './WalletDetail';
import { WalletSwitcher, type WalletScope } from './WalletSwitcher';
import { WalletManageList } from './WalletManageList';

/**
 * Global WebSocket nudge the account-history module broadcasts after each
 * ingestion tick. It carries no progress data — it is a signal to refetch the
 * authoritative per-wallet status, mirroring how the admin stats page reacts.
 */
const HISTORY_STATS_EVENT = 'account-history:stats';

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
     * resolved during SSR. Seeds the per-wallet sync state so it paints with the
     * switcher (no loading flash); live updates replace it after hydration.
     */
    initialProgress: IAccountIngestionProgress[];

    /**
     * SSR-resolved aggregate portfolio summary, seeding the landing hero so net
     * worth paints immediately with no skeleton. Null when the SSR fetch failed
     * (e.g. no snapshot yet) — the aggregate hero then falls back to a client
     * fetch. Only the aggregate scope is seeded; per-wallet zooms self-fetch.
     */
    initialPortfolio: IPortfolioSummary | null;
}

/**
 * Wallet management panel.
 *
 * @param props - {@link IWalletManagerProps}.
 */
export function WalletManager({ initialWallets, initialProgress, initialPortfolio }: IWalletManagerProps) {
    const { push } = useToast();
    const [wallets, setWallets] = useState<ILinkedWallet[]>(initialWallets);
    // Per-wallet history-download progress, seeded from SSR so the switcher paints
    // its sync dots immediately. Replaced wholesale on each refetch (server is
    // authoritative).
    const [progress, setProgress] = useState<IAccountIngestionProgress[]>(initialProgress);
    // A per-action key (e.g. 'link' or 'unlink:T...') marks which control is
    // mid-flight; a single key also disables the others so two signature
    // prompts can't race.
    const [busyKey, setBusyKey] = useState<string | null>(null);
    // The active scope drives the hero and detail: null is the all-wallets
    // aggregate (the default landing view), a string is one wallet's zoom.
    const [activeScope, setActiveScope] = useState<WalletScope>(null);
    // The aggregate portfolio hero, seeded from SSR so it paints with no skeleton.
    // Held here rather than inside PortfolioPanel so a wallet mutation can refetch
    // it — the panel stays mounted under an unchanging seed while the aggregate
    // scope is shown, so its own effect never re-runs and would otherwise leave net
    // worth on pre-mutation numbers after a link / unlink.
    const [aggregatePortfolio, setAggregatePortfolio] = useState<IPortfolioSummary | null>(initialPortfolio);

    // Index progress by address so the switcher and manage list render each
    // wallet's status in one lookup.
    const progressByAddress = useMemo(
        () => new Map(progress.map((entry) => [entry.address, entry])),
        [progress]
    );

    // If the active wallet is unlinked out from under the zoom, fall back to the
    // aggregate so the hero never points at a wallet that no longer exists.
    useEffect(() => {
        if (activeScope !== null && !wallets.some((wallet) => wallet.address === activeScope)) {
            setActiveScope(null);
        }
    }, [wallets, activeScope]);

    /**
     * Refetch the caller's wallet history progress and replace local state.
     * Best-effort: a failure leaves the last-known state in place rather than
     * surfacing an error, since the status is secondary to wallet management.
     */
    const refreshProgress = useCallback(async (): Promise<void> => {
        try {
            const next = await fetchWalletHistoryProgress();
            setProgress(next);
        } catch {
            // Keep the existing state; progress is non-critical.
        }
    }, []);

    /**
     * Refetch the aggregate portfolio and replace local state. Best-effort: the
     * hero is a secondary surface, so a failure keeps the last-known numbers in
     * place rather than surfacing an error across the whole panel.
     */
    const refreshPortfolio = useCallback(async (): Promise<void> => {
        try {
            const next = await fetchAggregatePortfolio();
            setAggregatePortfolio(next);
        } catch {
            // Keep the existing summary; valuation is non-critical here.
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
                // A link / unlink changes the valued wallet set, so revalue the
                // aggregate hero too — its own effect can't while it stays mounted
                // under an unchanging seed.
                void refreshPortfolio();
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
        [push, refreshProgress, refreshPortfolio]
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

    // No wallets yet: a focused onboarding card with the single primary action,
    // rather than an empty switcher and a zeroed hero.
    if (wallets.length === 0) {
        return (
            <Card>
                <Stack gap="md">
                    <p className="text-muted">
                        Link a TRON wallet by signing a one-time challenge in TronLink. Linking proves you
                        control the address — no transaction or fee — and unlocks your portfolio, activity,
                        and full transaction history here.
                    </p>
                    <Button
                        variant="primary"
                        size="sm"
                        icon={<Wallet size={18} aria-hidden />}
                        onClick={handleLink}
                        loading={busyKey === 'link'}
                        disabled={busyKey !== null}
                    >
                        Link a wallet
                    </Button>
                </Stack>
            </Card>
        );
    }

    const activeProgress = activeScope !== null ? progressByAddress.get(activeScope) : undefined;

    return (
        <Stack gap="lg">
            <WalletSwitcher
                wallets={wallets}
                progressByAddress={progressByAddress}
                activeScope={activeScope}
                onSelect={setActiveScope}
            />

            {activeScope === null ? (
                <PortfolioPanel initialSummary={aggregatePortfolio} />
            ) : (
                <WalletDetailPanel address={activeScope} progress={activeProgress} />
            )}

            <WalletManageList
                wallets={wallets}
                progressByAddress={progressByAddress}
                busyKey={busyKey}
                onLink={handleLink}
                onSetPrimary={handleSetPrimary}
                onUnlink={handleUnlink}
            />
        </Stack>
    );
}
