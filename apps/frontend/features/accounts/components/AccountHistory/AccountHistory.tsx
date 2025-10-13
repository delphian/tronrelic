'use client';

import type { TronTransactionDocument } from '@tronrelic/shared';
import { Card } from '../../../../components/ui/Card';
import { Skeleton } from '../../../../components/ui/Skeleton';
import { Pagination } from '../../../../components/ui/Pagination';
import { TransactionFilter, type TransactionFilterValue } from '../../../transactions/components/TransactionFilter';
import styles from './AccountHistory.module.css';

/**
 * Properties for the AccountHistory component.
 */
interface AccountHistoryProps {
    /** Array of transaction documents to display */
    transactions: TronTransactionDocument[];
    /** Total number of transactions across all pages */
    total: number;
    /** Number of transactions per page */
    pageSize: number;
    /** Current page number (1-indexed) */
    currentPage: number;
    /** If true, displays loading skeletons instead of transactions */
    loading?: boolean;
    /** Current filter values applied to the transaction list */
    filter?: TransactionFilterValue;
    /** Callback when filter values change */
    onFilterChange?: (value: TransactionFilterValue) => void;
    /** Callback when reset filters button is clicked */
    onResetFilters?: () => void;
    /** Callback when page changes */
    onPageChange?: (page: number) => void;
}

/**
 * AccountHistory - Displays paginated transaction history with filtering
 *
 * Shows recent blockchain activity for an account including:
 * - Transaction amounts (TRX)
 * - Sender and recipient addresses
 * - Transaction timestamps
 * - Contract types (formatted for readability)
 * - Memos (truncated if long)
 * - Energy and bandwidth consumption
 *
 * Supports filtering by transaction type, date range, and amount thresholds.
 * Pagination allows browsing through historical transactions efficiently.
 *
 * @param props - Component properties with transactions, pagination state, and callbacks
 * @returns A card containing filtered, paginated transaction history
 */
export function AccountHistory({
    transactions,
    total,
    pageSize,
    currentPage,
    loading = false,
    filter,
    onFilterChange,
    onResetFilters,
    onPageChange
}: AccountHistoryProps) {
    return (
        <Card padding="lg">
            <div className={styles.container}>
                <header className={styles.header}>
                    <h2 className={styles.header__title}>Recent activity</h2>
                    <p className={styles.header__description}>
                        Latest transactions processed for this wallet with energy and memo context.
                    </p>
                </header>

                {onFilterChange && (
                    <TransactionFilter
                        value={filter ?? {}}
                        onChange={onFilterChange}
                        onReset={onResetFilters}
                    />
                )}

                <section className={styles.transactions}>
                    {loading && (
                        <div className={styles.loading_state}>
                            {Array.from({ length: 5 }).map((_, index) => (
                                <Skeleton key={index} style={{ height: '84px', borderRadius: 'var(--radius-lg)' }} />
                            ))}
                        </div>
                    )}

                    {!loading && transactions.length === 0 && (
                        <div className={styles.empty_state}>No transactions match your filters in this range.</div>
                    )}

                    {!loading && transactions.map(transaction => (
                        <article key={transaction.txId} className={styles.transaction}>
                            <header className={styles.transaction__header}>
                                <strong className={styles.transaction__amount}>
                                    {transaction.amountTRX.toLocaleString()} TRX
                                </strong>
                                <span className={styles.transaction__timestamp}>
                                    {new Date(transaction.timestamp).toLocaleString()}
                                </span>
                            </header>
                            <div className={styles.transaction__addresses}>
                                {transaction.from.address} → {transaction.to.address}
                            </div>
                            <footer className={styles.transaction__footer}>
                                <span>{formatType(transaction.type)}</span>
                                {transaction.memo && <span>Memo: {truncate(transaction.memo, 72)}</span>}
                                {transaction.energy && <span>Energy: {transaction.energy.consumed.toLocaleString()} units</span>}
                                {transaction.bandwidth && <span>Bandwidth: {transaction.bandwidth.consumed.toLocaleString()} units</span>}
                            </footer>
                        </article>
                    ))}
                </section>

                <div className={styles.pagination_wrapper}>
                    <Pagination
                        total={total}
                        pageSize={pageSize}
                        currentPage={currentPage}
                        onPageChange={page => onPageChange?.(page)}
                    />
                </div>
            </div>
        </Card>
    );
}

/**
 * Formats transaction type for human-readable display.
 *
 * Transforms camelCase contract types (e.g., "TransferContract")
 * into spaced, readable format (e.g., "Transfer").
 *
 * @param type - Raw transaction type from TronTransactionDocument
 * @returns Formatted transaction type string
 */
function formatType(type: TronTransactionDocument['type']) {
    return type.replace(/([A-Z])/g, ' $1').replace(/Contract/, '').trim();
}

/**
 * Truncates a string to maximum length with ellipsis.
 *
 * Used for displaying long memo fields without breaking layout.
 * Preserves full string if already under the limit.
 *
 * @param value - String to truncate
 * @param maxLength - Maximum character length before truncation
 * @returns Original string or truncated string with ellipsis (…)
 */
function truncate(value: string, maxLength: number) {
    if (value.length <= maxLength) {
        return value;
    }
    return `${value.slice(0, maxLength - 3)}…`;
}
