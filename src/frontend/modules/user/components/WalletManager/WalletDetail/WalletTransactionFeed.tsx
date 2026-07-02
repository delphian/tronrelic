'use client';

/**
 * @fileoverview The decoded transaction feed — the workhorse panel.
 *
 * Turns the raw ledger into human-readable rows ("Sent 250 USDT", "Delegated
 * resources") rather than dumping hashes and contract types. Rows are grouped
 * under day headers so the feed reads as a scannable timeline (a transaction
 * list is an audit surface, so it paginates rather than infinite-scrolls — the
 * user can find, compare, and return to a position). It fetches its own page on
 * mount and paginates independently of the summary panels, so a loading state is
 * appropriate here (secondary, user-triggered content, not the page's primary
 * render).
 */

import { useCallback, useEffect, useState } from 'react';
import { ListOrdered } from 'lucide-react';
import type { IBlockTransaction } from '@/types';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../components/ui/Table';
import { Badge } from '../../../../../components/ui/Badge';
import { Skeleton } from '../../../../../components/ui/Skeleton';
import { Pagination } from '../../../../../components/ui/Pagination';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { AddressDisplay, WalletDetailSection } from './WalletDetailPrimitives';
import { fetchWalletTransactions, type IWalletTransactionPage } from '../../../api/account-history-user.api';
import { decodeTronTransaction } from '../../../lib/decodeTronTransaction';
import styles from './WalletDetail.module.scss';

/** Rows per page in the feed. */
const PAGE_SIZE = 25;

/** Locale-independent month abbreviations, for hydration-safe day headers (UTC). */
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Props for {@link WalletTransactionFeed}.
 */
interface IWalletTransactionFeedProps {
    /** The base58 wallet whose history to page through. */
    address: string;
}

/**
 * Compute a stable UTC day key (`YYYY-MM-DD`) for grouping a transaction, and a
 * human header label for the day separator. UTC keeps grouping deterministic
 * regardless of viewer timezone.
 *
 * @param timestamp - The transaction timestamp (Date or ISO string).
 * @returns The day key and a `MMM D, YYYY` header label.
 */
function dayOf(timestamp: IBlockTransaction['timestamp']): { key: string; label: string } {
    const date = new Date(timestamp);
    const key = date.toISOString().slice(0, 10);
    const label = `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
    return { key, label };
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
 * Render the wallet's decoded, day-grouped, paginated transaction feed.
 *
 * @param props - {@link IWalletTransactionFeedProps}.
 * @returns The transaction feed section.
 */
export function WalletTransactionFeed({ address }: IWalletTransactionFeedProps) {
    const [page, setPage] = useState<IWalletTransactionPage | null>(null);
    const [offset, setOffset] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Reset to the first page when the wallet changes so a switch never lands on
    // an offset past the new wallet's history. Done during render (not in an
    // effect) to match the sibling detail panel's reset and stay self-contained:
    // if this feed were ever retained across an address change, the fetch effect
    // could not fire at the prior wallet's stale offset.
    const [prevAddress, setPrevAddress] = useState(address);
    if (address !== prevAddress) {
        setPrevAddress(address);
        setOffset(0);
    }

    // Load the page whenever the offset (or wallet) changes.
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

    const goToPage = useCallback((next: number) => {
        setOffset((next - 1) * PAGE_SIZE);
    }, []);

    const total = page?.total ?? 0;
    const transactions = page?.transactions ?? [];
    const labels = page?.labels ?? {};
    const rangeStart = total === 0 ? 0 : offset + 1;
    const rangeEnd = Math.min(offset + PAGE_SIZE, total);
    const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

    // The day the previous row belonged to, so a header renders only when the day
    // changes across the page (rows arrive newest-first, already time-ordered).
    let lastDayKey: string | null = null;

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
                                const day = dayOf(tx.timestamp);
                                const showDayHeader = day.key !== lastDayKey;
                                lastDayKey = day.key;
                                return (
                                    <TransactionRows
                                        key={`${tx.txId}-${tx.type}-${tx.to.address}`}
                                        dayHeader={showDayHeader ? day.label : null}
                                        label={decoded.label}
                                        amount={decoded.amount || '—'}
                                        amountClass={amountClass}
                                        counterparty={counterparty}
                                        counterpartyLabel={counterparty ? labels[counterparty] : undefined}
                                        timestamp={tx.timestamp}
                                        status={tx.status}
                                    />
                                );
                            })}
                        </Tbody>
                    </Table>
                    <div className={styles.feed_footer}>
                        <span className={styles.feed_status}>
                            {rangeStart.toLocaleString()}–{rangeEnd.toLocaleString()} of {total.toLocaleString()}
                        </span>
                        <Pagination
                            total={total}
                            pageSize={PAGE_SIZE}
                            currentPage={currentPage}
                            onPageChange={goToPage}
                        />
                    </div>
                </>
            )}
        </WalletDetailSection>
    );
}

/**
 * Props for {@link TransactionRows}.
 */
interface ITransactionRowsProps {
    /** Day header label to render above this row, or null to continue the current day. */
    dayHeader: string | null;
    /** Decoded action label. */
    label: string;
    /** Formatted amount, or an em dash placeholder. */
    amount: string;
    /** Directional colour class for the amount cell, if any. */
    amountClass?: string;
    /** Counterparty base58 address, or empty. */
    counterparty: string;
    /** Human-friendly label for the counterparty, when the label service knows it. */
    counterpartyLabel?: string;
    /** Row timestamp. */
    timestamp: IBlockTransaction['timestamp'];
    /** Transaction status. */
    status: string;
}

/**
 * Render one transaction row, optionally preceded by a day-separator header row.
 * Grouping rows behind a lightweight component keeps the feed body declarative
 * and the JSDoc-per-function rule satisfied without an inline fragment map.
 *
 * @param props - {@link ITransactionRowsProps}.
 * @returns The (optional header +) transaction row.
 */
function TransactionRows({ dayHeader, label, amount, amountClass, counterparty, counterpartyLabel, timestamp, status }: ITransactionRowsProps) {
    return (
        <>
            {dayHeader && (
                <Tr>
                    <Td colSpan={5}>
                        <span className={styles.day_header}>{dayHeader}</span>
                    </Td>
                </Tr>
            )}
            <Tr>
                <Td>{label}</Td>
                <Td className={amountClass ? `${amountClass} ${styles.feed_cell}` : styles.feed_cell}>{amount}</Td>
                <Td className={styles.feed_cell}>
                    {counterparty ? (
                        <AddressDisplay address={counterparty} label={counterpartyLabel} />
                    ) : '—'}
                </Td>
                <Td muted className={styles.feed_cell}><ClientTime date={timestamp} format="datetime" /></Td>
                <Td className={styles.feed_cell}>
                    <Badge tone={status === 'SUCCESS' ? 'success' : 'danger'}>{status}</Badge>
                </Td>
            </Tr>
        </>
    );
}
