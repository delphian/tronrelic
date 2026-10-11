'use client';

/**
 * @fileoverview The demoted wallet-management surface.
 *
 * Linking, promoting, and unlinking a wallet are rare, deliberate, and (for
 * unlink) destructive — so they no longer sit at full weight beside the
 * portfolio. This section collapses to a single header row (title, count,
 * Manage, Link) and opens into a compact table of the linked wallets, so the
 * controls stay one click away without competing with the day-to-day act of
 * viewing balances. The mutation logic stays in the parent orchestrator; this
 * component only renders the controls and reports intent back through the
 * handler props.
 */

import { useId, useState } from 'react';
import { Wallet, Star, Unlink, ChevronDown, ChevronUp } from 'lucide-react';
import type { IAccountIngestionProgress, ILinkedWallet } from '@/types';
import { Panel } from '../../../../components/ui/Panel';
import { Button } from '../../../../components/ui/Button';
import { CopyButton } from '../../../../components/ui/CopyButton';
import { Tooltip } from '../../../../components/ui/Tooltip';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../components/ui/Table';
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
 * @returns The linked-wallets panel: a header row, plus the wallet table when expanded.
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
    // Ties the Manage toggle to the table it reveals, for assistive tech.
    const tableId = useId();
    const busy = busyKey !== null;

    return (
        <Panel
            title="Linked wallets"
            meta={`${wallets.length} linked`}
            actions={
                <>
                    <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => setExpanded((value) => !value)}
                        aria-expanded={expanded}
                        aria-controls={tableId}
                    >
                        {expanded ? 'Hide' : 'Manage'}
                        {expanded ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
                    </Button>
                    <Button
                        variant="primary"
                        size="xs"
                        icon={<Wallet size={14} aria-hidden />}
                        onClick={onLink}
                        loading={busyKey === 'link'}
                        disabled={busy}
                        title="Sign a one-time challenge in TronLink. No transaction or fee."
                    >
                        Link a wallet
                    </Button>
                </>
            }
        >
            {expanded && (
                <Table id={tableId} variant="compact" flush>
                    <Thead>
                        <Tr>
                            <Th width="expand">Address</Th>
                            <Th>Linked</Th>
                            <Th>History</Th>
                            <Th width="shrink" aria-label="Actions" />
                        </Tr>
                    </Thead>
                    <Tbody>
                        {wallets.map((wallet) => {
                            const progress = progressByAddress.get(wallet.address);
                            const status = progress ? describeHistoryStatus(progress) : null;
                            return (
                                <Tr key={wallet.address}>
                                    <Td>
                                        <span className={styles.address_row}>
                                            {wallet.isPrimary && (
                                                <Star size={12} aria-label="Primary wallet" style={{ color: 'var(--color-warning)' }} />
                                            )}
                                            <Tooltip content={wallet.address}>
                                                <span className={styles.address}>{truncateAddress(wallet.address)}</span>
                                            </Tooltip>
                                            <CopyButton
                                                value={wallet.address}
                                                size="xs"
                                                aria-label="Copy wallet address"
                                            />
                                        </span>
                                    </Td>
                                    <Td muted className={styles.nowrap}>
                                        <ClientTime date={wallet.linkedAt} format="date" />
                                    </Td>
                                    <Td muted className={styles.nowrap}>{status ? status.label : '—'}</Td>
                                    <Td>
                                        <span className={styles.actions}>
                                            {!wallet.isPrimary && (
                                                <Button
                                                    variant="ghost"
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
                                        </span>
                                    </Td>
                                </Tr>
                            );
                        })}
                    </Tbody>
                </Table>
            )}
        </Panel>
    );
}
