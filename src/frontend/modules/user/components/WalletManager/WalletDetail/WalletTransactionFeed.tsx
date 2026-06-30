'use client';

/**
 * @fileoverview The decoded transaction feed — the workhorse panel.
 *
 * Turns the raw ledger into human-readable rows ("Sent 250 USDT", "Delegated
 * resources") rather than dumping hashes and contract types, the one feature the
 * leading wallets are consistently praised for. It fetches its own page on mount
 * and paginates independently of the summary panels, so it is self-contained and
 * a loading state is appropriate (this is secondary, user-triggered content, not
 * the page's primary render).
 */

import { useCallback, useEffect, useState } from 'react';
import { ListOrdered } from 'lucide-react';
import type { IAccountTransactionPage, IBlockTransaction } from '@/types';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../components/ui/Table';
import { Badge } from '../../../../../components/ui/Badge';
import { Button } from '../../../../../components/ui/Button';
import { Skeleton } from '../../../../../components/ui/Skeleton';
import { Tooltip } from '../../../../../components/ui/Tooltip';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { WalletDetailSection } from './WalletDetailPrimitives';
import { fetchWalletTransactions } from '../../../api/account-history-user.api';
import { decodeTronTransaction } from '../../../lib/decodeTronTransaction';
import { truncateAddress } from '../../../lib/walletFormat';
import styles from './WalletDetail.module.scss';

/** Rows per page in the feed. */
const PAGE_SIZE = 25;

/**
 * Props for {@link WalletTransactionFeed}.
 */
interface IWalletTransactionFeedProps {
    /** The base58 wallet whose history to page through. */
    address: string;
}

/**
 * Resolve the counterparty address for a row from the decoded direction: the
 * recipient when the wallet sent, the sender when it received.
 *
 * @param tx - The transaction.
 * @param wallet - The viewed wallet.
 * @param direction - The decoded value direction.
 * @returns The counterparty's base58 address.
 */
function counterpartyOf(tx: IBlockTransaction, wallet: string, direction: string): string {
    if (direction === 'out') {
        return tx.to?.address ?? '';
    }
    if (direction === 'in') {
        return tx.from?.address ?? '';
    }
    return tx.to?.address ?? wallet;
}

/**
 * Render the wallet's decoded, paginated transaction feed.
 *
 * @param props - {@link IWalletTransactionFeedProps}.
 * @returns The transaction feed section.
 */
export function WalletTransactionFeed({ address }: IWalletTransactionFeedProps) {
    const [page, setPage] = useState<IAccountTransactionPage | null>(null);
    const [offset, setOffset] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Load the page whenever the offset (or wallet) changes. The wallet is fixed
    // for a mounted feed, so in practice this re-runs on Prev/Next.
    useEffect(() => {
        let active = true;
        setLoading(true);
        setError(null);
        fetchWalletTransactions(address, PAGE_SIZE, offset)
            .then((result) => {
                if (active) {
                    setPage(result);
                }
            })
            .catch((cause: unknown) => {
                if (active) {
                    setError(cause instanceof Error ? cause.message : 'Failed to load transactions.');
                }
            })
            .finally(() => {
                if (active) {
                    setLoading(false);
                }
            });
        return () => {
            active = false;
        };
    }, [address, offset]);

    const goPrev = useCallback(() => setOffset((current) => Math.max(0, current - PAGE_SIZE)), []);
    const goNext = useCallback(() => setOffset((current) => current + PAGE_SIZE), []);

    const total = page?.total ?? 0;
    const transactions = page?.transactions ?? [];
    const rangeStart = total === 0 ? 0 : offset + 1;
    const rangeEnd = Math.min(offset + PAGE_SIZE, total);
    const canPrev = offset > 0;
    const canNext = offset + PAGE_SIZE < total;

    return (
        <WalletDetailSection icon={<ListOrdered size={16} aria-hidden />} title="Transactions">
            {error ? (
                <div className="alert">{error}</div>
            ) : !page && loading ? (
                <Skeleton style={{ width: '100%', height: '12rem' }} />
            ) : transactions.length === 0 ? (
                <p className="text-muted">No transactions recorded for this wallet.</p>
            ) : (
                <>
                    <Table variant="compact">
                        <Thead>
                            <Tr>
                                <Th width="expand">Action</Th>
                                <Th>Amount</Th>
                                <Th>Counterparty</Th>
                                <Th>When</Th>
                                <Th>Status</Th>
                            </Tr>
                        </Thead>
                        <Tbody>
                            {transactions.map((tx) => {
                                const decoded = decodeTronTransaction(tx, address);
                                const counterparty = counterpartyOf(tx, address, decoded.direction);
                                const amountClass = decoded.direction === 'in'
                                    ? styles.value_in
                                    : decoded.direction === 'out'
                                        ? styles.value_out
                                        : undefined;
                                return (
                                    <Tr key={`${tx.txId}-${tx.type}`}>
                                        <Td>{decoded.label}</Td>
                                        <Td className={amountClass}>{decoded.amount || '—'}</Td>
                                        <Td>
                                            {counterparty ? (
                                                <Tooltip content={counterparty}>
                                                    <span className={styles.address}>{truncateAddress(counterparty)}</span>
                                                </Tooltip>
                                            ) : '—'}
                                        </Td>
                                        <Td muted><ClientTime date={tx.timestamp} format="datetime" /></Td>
                                        <Td>
                                            <Badge tone={tx.status === 'SUCCESS' ? 'success' : 'danger'}>{tx.status}</Badge>
                                        </Td>
                                    </Tr>
                                );
                            })}
                        </Tbody>
                    </Table>
                    <div className={styles.feed_footer}>
                        <span className={styles.feed_status}>
                            {rangeStart.toLocaleString()}–{rangeEnd.toLocaleString()} of {total.toLocaleString()}
                        </span>
                        <span className={styles.flow_toggle}>
                            <Button variant="ghost" size="xs" onClick={goPrev} disabled={!canPrev || loading}>
                                Previous
                            </Button>
                            <Button variant="ghost" size="xs" onClick={goNext} disabled={!canNext || loading}>
                                Next
                            </Button>
                        </span>
                    </div>
                </>
            )}
        </WalletDetailSection>
    );
}
