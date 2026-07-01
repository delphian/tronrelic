'use client';

/**
 * @fileoverview The demoted wallet-management surface.
 *
 * Linking, promoting, and unlinking a wallet are rare, deliberate, and (for
 * unlink) destructive — so they no longer sit at full weight beside the
 * portfolio. This collapsible section keeps them one click away without letting
 * a danger button compete with the day-to-day act of viewing balances. The
 * mutation logic stays in the parent orchestrator; this component only renders
 * the controls and reports intent back through the handler props.
 */

import { useState } from 'react';
import { Wallet, Star, Unlink, ChevronDown, ChevronUp, Settings2 } from 'lucide-react';
import type { IAccountIngestionProgress, ILinkedWallet } from '@/types';
import { Card } from '../../../../components/ui/Card';
import { Button } from '../../../../components/ui/Button';
import { Badge } from '../../../../components/ui/Badge';
import { CopyButton } from '../../../../components/ui/CopyButton';
import { Tooltip } from '../../../../components/ui/Tooltip';
import { Stack } from '../../../../components/layout';
import { ClientTime } from '../../../../components/ui/ClientTime';
import { truncateAddress } from '../../lib/walletFormat';
import { describeHistoryStatus } from '../../lib/walletHistoryStatus';
import styles from './WalletManager.module.scss';

/**
 * Props for {@link WalletManageList}.
 */
export interface IWalletManageListProps {
    /** The account's linked wallets. */
    wallets: ILinkedWallet[];

    /** Per-address ingestion progress, for the small status label per row. */
    progressByAddress: Map<string, IAccountIngestionProgress>;

    /** The in-flight action key, or null when idle; disables controls to prevent races. */
    busyKey: string | null;

    /** Link the wallet currently active in TronLink. */
    onLink: () => void;

    /** Promote the given wallet to primary. */
    onSetPrimary: (address: string) => void;

    /** Detach the given wallet from the account. */
    onUnlink: (address: string) => void;
}

/**
 * Render the collapsible wallet-management panel.
 *
 * @param props - {@link IWalletManageListProps}.
 * @returns The manage-wallets card.
 */
export function WalletManageList({
    wallets,
    progressByAddress,
    busyKey,
    onLink,
    onSetPrimary,
    onUnlink
}: IWalletManageListProps) {
    // Collapsed by default so management stays out of the portfolio's way; the
    // user opens it only when they actually intend to link/promote/unlink.
    const [expanded, setExpanded] = useState(false);
    const busy = busyKey !== null;

    return (
        <Card tone="muted">
            <div className={styles.manage_header}>
                <Button
                    variant="ghost"
                    size="sm"
                    icon={<Settings2 size={16} aria-hidden />}
                    onClick={() => setExpanded((value) => !value)}
                    aria-expanded={expanded}
                >
                    Manage wallets
                    {expanded ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
                </Button>
                <Button
                    variant="primary"
                    size="sm"
                    icon={<Wallet size={18} aria-hidden />}
                    onClick={onLink}
                    loading={busyKey === 'link'}
                    disabled={busy}
                >
                    Link a wallet
                </Button>
            </div>

            {expanded && (
                <Stack gap="sm">
                    <p className="text-muted">
                        Link a TRON wallet by signing a one-time challenge in TronLink. Linking proves you
                        control the address — no transaction or fee.
                    </p>
                    {wallets.length === 0 ? (
                        <p className="text-muted">No wallets linked yet.</p>
                    ) : (
                        <ul className={`list--plain ${styles.list}`}>
                            {wallets.map((wallet) => {
                                const progress = progressByAddress.get(wallet.address);
                                const status = progress ? describeHistoryStatus(progress) : null;
                                return (
                                    <li key={wallet.address} className={styles.entry}>
                                        <div className={styles.row}>
                                            <div className={styles.identity}>
                                                <span className={styles.address_row}>
                                                    <Tooltip content={wallet.address}>
                                                        <span className={styles.address}>{truncateAddress(wallet.address)}</span>
                                                    </Tooltip>
                                                    <CopyButton
                                                        value={wallet.address}
                                                        size="xs"
                                                        ariaLabel="Copy wallet address"
                                                    />
                                                </span>
                                                <span className={styles.meta}>
                                                    Linked <ClientTime date={wallet.linkedAt} format="date" />
                                                    {status && ` · ${status.label}`}
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
                                                        onClick={() => onSetPrimary(wallet.address)}
                                                        loading={busyKey === `primary:${wallet.address}`}
                                                        disabled={busy}
                                                    >
                                                        Make primary
                                                    </Button>
                                                )}
                                                <Button
                                                    variant="ghost"
                                                    size="xs"
                                                    icon={<Unlink size={14} aria-hidden />}
                                                    onClick={() => onUnlink(wallet.address)}
                                                    loading={busyKey === `unlink:${wallet.address}`}
                                                    disabled={busy}
                                                >
                                                    Unlink
                                                </Button>
                                            </div>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </Stack>
            )}
        </Card>
    );
}
