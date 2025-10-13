'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { TronTransactionDocument } from '@tronrelic/shared';
import { useAppDispatch, useAppSelector } from '../../../../store/hooks';
import { setTransactions, type LiveTransaction, type RealtimeTransactionEvent } from '../../slice';
import { Card } from '../../../../components/ui/Card';
import { Badge } from '../../../../components/ui/Badge';
import { cn } from '../../../../lib/cn';
import { useRealtimeStatus } from '../../../realtime/hooks/useRealtimeStatus';
import { useSocketSubscription } from '../../../realtime/hooks/useSocketSubscription';
import styles from './TransactionFeed.module.css';

interface ITransactionFeedProps {
    initialTransactions: TronTransactionDocument[];
}

const RECENT_WINDOW_MS = 120_000;
const NOW_TICK_INTERVAL_MS = 5_000;

/**
 * Renders the live transaction alerts card that displays real-time whale movements, delegations, and staking activity.
 *
 * This component subscribes to the WebSocket transaction stream, filters entries to show only the most recent alerts
 * within a rolling 2-minute window, and highlights the newest transaction with a visual flash animation so traders
 * can immediately notice fresh whale activity. The feed automatically updates every 5 seconds to age out older entries
 * and maintains a Redux store of live transactions for cross-component access.
 *
 * @param initialTransactions - Server-side hydration data containing the most recent transactions on page load
 * @returns A card displaying live transaction alerts with real-time connection status indicator
 */
export function TransactionFeed({ initialTransactions }: ITransactionFeedProps) {
    const dispatch = useAppDispatch();
    const transactions = useAppSelector(state => state.transactions.transactions);
    const realtime = useRealtimeStatus();
    const [highlightTxId, setHighlightTxId] = useState<string | null>(null);
    const [now, setNow] = useState<number>(() => Date.now());
    const hydratedRef = useRef(false);

    const subscription = useMemo(() => ({ transactions: { minAmount: 10_000 } }), []);
    useSocketSubscription(subscription);

    /**
     * Hydrates the Redux store with initial server-side transactions on component mount.
     * This ensures the feed displays data immediately while waiting for the WebSocket connection.
     */
    useEffect(() => {
        if (!initialTransactions.length) {
            return;
        }
        dispatch(setTransactions(initialTransactions));
    }, [dispatch, initialTransactions]);

    /**
     * Updates the current timestamp every 5 seconds to trigger recalculation of which transactions
     * fall within the recent time window, automatically aging out older entries.
     */
    useEffect(() => {
        const intervalId = window.setInterval(() => {
            setNow(Date.now());
        }, NOW_TICK_INTERVAL_MS);

        return () => window.clearInterval(intervalId);
    }, []);

    /**
     * Filters the transaction list to only include entries within the last 2 minutes.
     * Transactions with invalid timestamps are included by default to avoid data loss.
     */
    const recentTransactions = useMemo(() => {
        const cutoff = now - RECENT_WINDOW_MS;

        return transactions.filter((transaction: LiveTransaction) => {
            const parsedTimestamp = new Date(transaction.timestamp).getTime();
            if (!Number.isFinite(parsedTimestamp)) {
                return true;
            }
            return parsedTimestamp >= cutoff;
        });
    }, [transactions, now]);

    const newestTxId = recentTransactions[0]?.txId;

    /**
     * Highlights the newest transaction with a flash animation for 3.2 seconds when a new transaction arrives.
     * Skips the initial hydration to avoid flashing on page load.
     */
    useEffect(() => {
        if (!hydratedRef.current) {
            hydratedRef.current = true;
            return;
        }

        if (!newestTxId) {
            setHighlightTxId(null);
            return;
        }

        setHighlightTxId(newestTxId);
        const timer = window.setTimeout(() => {
            setHighlightTxId(current => (current === newestTxId ? null : current));
        }, 3200);

        return () => window.clearTimeout(timer);
    }, [newestTxId]);

    /**
     * Maps a realtime event type to its display metadata (label and badge tone).
     *
     * @param event - The transaction event type from the WebSocket subscription
     * @returns Display metadata for the event badge, or null if no event is present
     */
    const formatEventMeta = (event?: RealtimeTransactionEvent) => {
        if (!event) {
            return null;
        }
        const map: Record<RealtimeTransactionEvent, { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' }> = {
            'transaction:large': { label: 'Whale transfer', tone: 'warning' },
            'delegation:new': { label: 'Delegation', tone: 'success' },
            'stake:new': { label: 'Stake update', tone: 'neutral' }
        };
        return map[event] ?? null;
    };

    return (
        <Card>
            <header className={styles.header}>
                <div className={styles.header__content}>
                    <h2 className={styles.header__title}>Live transaction alerts</h2>
                    <p className={`text-subtle ${styles.header__description}`}>Whale movements, delegations, and staking activity detected in real time.</p>
                </div>
                <Badge tone={realtime.tone} aria-live="polite" suppressHydrationWarning>
                    <span suppressHydrationWarning>{realtime.label}</span>
                    {realtime.latencyMs !== null && (
                        <span style={{ marginLeft: '0.35rem', fontSize: '0.7rem', opacity: 0.75 }} suppressHydrationWarning>
                            {Math.round(realtime.latencyMs)} ms
                        </span>
                    )}
                </Badge>
            </header>
            <div className={styles.transactions}>
                {recentTransactions.map((transaction: LiveTransaction) => {
                    const meta = formatEventMeta(transaction.realtimeEvent);
                    return (
                        <article
                            key={transaction.txId}
                            className={cn('surface surface--padding-sm', styles.transaction, highlightTxId === transaction.txId && 'surface--flash')}
                        >
                            <div className={styles.transaction__header}>
                                <strong className={styles.transaction__amount}>{(transaction.amountTRX ?? 0).toLocaleString()} TRX</strong>
                                <span className={`text-subtle ${styles.transaction__timestamp}`}>{new Date(transaction.timestamp).toLocaleString()}</span>
                            </div>
                            {meta && (
                                <div className={styles.transaction__badge}>
                                    <Badge tone={meta.tone}>{meta.label}</Badge>
                                </div>
                            )}
                            <div className={styles.transaction__addresses}>
                                {transaction.from.address} → {transaction.to.address}
                            </div>
                            {transaction.analysis?.pattern && (
                                <div className={`text-subtle ${styles.transaction__pattern}`}>Pattern: {transaction.analysis.pattern}</div>
                            )}
                        </article>
                    );
                })}
                {!recentTransactions.length && (
                    <div className={`text-subtle ${styles.empty}`}>No alerts detected in the last 60 seconds.</div>
                )}
            </div>
        </Card>
    );
}
