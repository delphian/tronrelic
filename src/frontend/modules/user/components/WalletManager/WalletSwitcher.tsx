'use client';

/**
 * @fileoverview Wallet scope switcher — the top-level control of the reformed
 * Wallets tab.
 *
 * Portfolio dashboards land on an aggregate view and let the user drill into a
 * single wallet (DeBank/MetaMask convention), so this segmented row leads with
 * an "All wallets" chip and follows with one chip per linked wallet. Each wallet
 * chip carries a truncated address, a primary star, and a small sync dot so the
 * per-wallet backfill state is visible without opening the wallet — keeping the
 * honest, count-based status (never a fake percentage) one glance away.
 */

import { Star } from 'lucide-react';
import type { IAccountIngestionProgress, ILinkedWallet } from '@/types';
import { truncateAddress } from '../../lib/walletFormat';
import { describeHistoryStatus, type WalletHistoryTone } from '../../lib/walletHistoryStatus';
import styles from './WalletManager.module.scss';

/**
 * The active scope: `null` is the all-wallets aggregate; a string is the base58
 * address of the single wallet being zoomed.
 */
export type WalletScope = string | null;

/**
 * Props for {@link WalletSwitcher}.
 */
export interface IWalletSwitcherProps {
    /** The account's linked wallets, in display order. */
    wallets: ILinkedWallet[];

    /** Per-address ingestion progress, for the sync dot on each chip. */
    progressByAddress: Map<string, IAccountIngestionProgress>;

    /** The currently active scope (`null` = aggregate). */
    activeScope: WalletScope;

    /** Invoked with the chosen scope when a chip is selected. */
    onSelect: (scope: WalletScope) => void;
}

/**
 * Resolve a history tone to the design token that colours the sync dot. Kept a
 * pure lookup so the dot never hardcodes a colour and follows the theme.
 *
 * @param tone - The badge tone from {@link describeHistoryStatus}.
 * @returns The CSS custom property expression for the dot's background.
 */
function toneColor(tone: WalletHistoryTone): string {
    switch (tone) {
        case 'success':
            return 'var(--color-success)';
        case 'info':
            return 'var(--color-primary)';
        case 'warning':
            return 'var(--color-warning)';
        case 'danger':
            return 'var(--color-danger)';
        default:
            return 'var(--color-text-muted)';
    }
}

/**
 * Render the aggregate/per-wallet scope switcher.
 *
 * @param props - {@link IWalletSwitcherProps}.
 * @returns The segmented switcher row, or null when there are no wallets.
 */
export function WalletSwitcher({ wallets, progressByAddress, activeScope, onSelect }: IWalletSwitcherProps) {
    if (wallets.length === 0) {
        return null;
    }
    return (
        <div className={styles.switcher}>
            <div className="segmented-control" role="group" aria-label="Wallet scope">
                <button
                    type="button"
                    aria-pressed={activeScope === null}
                    className={activeScope === null ? 'is-active' : undefined}
                    onClick={() => onSelect(null)}
                >
                    All wallets
                </button>
                {wallets.map((wallet) => {
                    const progress = progressByAddress.get(wallet.address);
                    const status = progress ? describeHistoryStatus(progress) : null;
                    const isActive = activeScope === wallet.address;
                    const title = status
                        ? `${wallet.address} — ${status.label}`
                        : wallet.address;
                    return (
                        <button
                            key={wallet.address}
                            type="button"
                            aria-pressed={isActive}
                            className={isActive ? 'is-active' : undefined}
                            onClick={() => onSelect(wallet.address)}
                            title={title}
                        >
                            <span className={styles.chip}>
                                {wallet.isPrimary && (
                                    <Star size={12} aria-hidden style={{ color: 'var(--color-warning)' }} />
                                )}
                                <span className={styles.chip_address}>{truncateAddress(wallet.address)}</span>
                                {status && (
                                    <span
                                        className={styles.sync_dot}
                                        style={{ background: toneColor(status.tone) }}
                                        aria-hidden
                                    />
                                )}
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
