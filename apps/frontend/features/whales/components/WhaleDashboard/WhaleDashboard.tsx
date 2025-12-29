'use client';

import { useEffect, useMemo, useState } from 'react';
// TODO: These functions need to be implemented in lib/api
// import {
//     getWhaleHighlights,
//     getWhaleTimeseries,
//     type TimeseriesPoint,
//     type WhaleHighlightRecord
// } from '../../../../lib/api';
type TimeseriesPoint = { date: string; value: number; max?: number; count?: number };
type WhaleHighlightRecord = { txId: string; amountTRX: number; timestamp: string; fromAddress: string; toAddress: string; memo?: string };
import { Stack } from '../../../../components/layout';
import { LineChart } from '../../../charts/components/LineChart';
import { Card } from '../../../../components/ui/Card';
import { Badge } from '../../../../components/ui/Badge';
import { Skeleton } from '../../../../components/ui/Skeleton';
import styles from './WhaleDashboard.module.css';

/**
 * Properties for the WhaleDashboard component.
 */
interface WhaleDashboardProps {
    /** Initial timeseries data for server-side rendering */
    initialSeries: TimeseriesPoint[];
    /** Initial highlights data for server-side rendering */
    initialHighlights: WhaleHighlightRecord[];
}

/**
 * Available time range options in days.
 */
const RANGE_OPTIONS = [7, 14, 30, 60];

/**
 * Formats large numbers with thousand separators.
 *
 * @param value - Number to format
 * @returns Formatted string with commas
 */
function formatAmount(value: number) {
    const formatter = new Intl.NumberFormat('en-US', {
        maximumFractionDigits: 0
    });
    return formatter.format(value);
}

/**
 * WhaleDashboard - Whale activity monitoring and analytics dashboard
 *
 * Displays comprehensive whale activity metrics including:
 * - **Timeseries chart** - TRX volume moved by whales over selected time range
 * - **Summary metrics** - Total volume, daily average, peak transaction, transaction count
 * - **Recent highlights** - List of latest high-value transfers with details
 * - **Time range selector** - Switch between 7, 14, 30, 60 day views
 *
 * The component uses server-side initial data for fast first render, then
 * refreshes highlights on mount to ensure freshness. Time range changes
 * trigger client-side API calls to fetch updated timeseries data.
 *
 * Whale threshold (what qualifies as a "whale transaction") is determined
 * by the backend API configuration, not this component.
 *
 * Features:
 * - Responsive grid layout adapting to available space
 * - Loading states with skeleton placeholders
 * - Error handling with user-friendly messages
 * - Automatic summary calculation from timeseries data
 *
 * @param props - Component properties with initial data
 * @returns A grid containing whale metrics card and highlights card
 */
export function WhaleDashboard({ initialSeries, initialHighlights }: WhaleDashboardProps) {
    const [series, setSeries] = useState(initialSeries);
    const [highlights, setHighlights] = useState(initialHighlights);
    const [selectedRange, setSelectedRange] = useState(14);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /**
     * Refreshes highlights once on mount to ensure data freshness.
     * Initial data may be stale if page was cached by Next.js.
     */
    useEffect(() => {
        // TODO: Re-enable once getWhaleHighlights is implemented in lib/api
        // void (async () => {
        //     try {
        //         const latestHighlights = await getWhaleHighlights(12);
        //         setHighlights(latestHighlights);
        //     } catch (highlightError) {
        //         console.error(highlightError);
        //     }
        // })();
    }, []);

    /**
     * Fetches updated timeseries data for the selected time range.
     *
     * @param range - Number of days to fetch (7, 14, 30, or 60)
     */
    const refreshSeries = async (range: number) => {
        setLoading(true);
        setError(null);
        try {
            // TODO: Re-enable once getWhaleTimeseries is implemented in lib/api
            // const updatedSeries = await getWhaleTimeseries(range);
            // setSeries(updatedSeries);
        } catch (fetchError) {
            console.error(fetchError);
            setError(fetchError instanceof Error ? fetchError.message : 'Unable to load timeseries');
        } finally {
            setLoading(false);
        }
    };

    /**
     * Calculates summary statistics from timeseries data.
     *
     * Computes:
     * - Total TRX volume across all days
     * - Daily average volume
     * - Peak single transaction amount
     * - Total number of whale transactions
     *
     * Memoized to avoid recalculation on unrelated re-renders.
     */
    const summary = useMemo(() => {
        if (!series.length) {
            return {
                total: 0,
                average: 0,
                peak: 0,
                activity: 0
            };
        }
        const total = series.reduce((acc, point) => acc + point.value, 0);
        const peak = Math.max(...series.map(point => point.max ?? point.value));
        const activity = series.reduce((acc, point) => acc + (point.count ?? 0), 0);
        return {
            total,
            average: total / series.length,
            peak,
            activity
        };
    }, [series]);

    /**
     * Handles time range selection changes.
     *
     * Only fetches new data if the range actually changed.
     * Shows loading state while fetching.
     *
     * @param range - New time range in days
     */
    const onRangeChange = async (range: number) => {
        if (range === selectedRange) {
            return;
        }
        setSelectedRange(range);
        await refreshSeries(range);
    };

    return (
        <div className={styles.container}>
            <Card>
                <Stack>
                    <header className={styles.header}>
                        <div className={styles.header__info}>
                            <h2 className={styles.header__title}>Whale capital flows</h2>
                            <p className={styles.header__description}>
                                Aggregated TRX volume from transfers above the whale threshold.
                            </p>
                        </div>
                        <div className="segmented-control">
                            {RANGE_OPTIONS.map(range => (
                                <button
                                    key={range}
                                    type="button"
                                    className={range === selectedRange ? 'is-active' : ''}
                                    onClick={() => onRangeChange(range)}
                                    disabled={true}
                                >
                                    {range}d
                                </button>
                            ))}
                        </div>
                    </header>

                    <section className={`stat-grid ${styles.metrics}`}>
                        <Card tone="muted" padding="sm">
                            <div className="stat-card__label">Total volume</div>
                            <div className="stat-card__value">{formatAmount(summary.total)} TRX</div>
                            <div className="stat-card__delta">Across {series.length} days</div>
                        </Card>
                        <Card tone="muted" padding="sm">
                            <div className="stat-card__label">Daily average</div>
                            <div className="stat-card__value">{formatAmount(summary.average)} TRX</div>
                            <div className="stat-card__delta">Whale inflow per day</div>
                        </Card>
                        <Card tone="muted" padding="sm">
                            <div className="stat-card__label">Largest move</div>
                            <div className="stat-card__value">{formatAmount(summary.peak)} TRX</div>
                            <div className="stat-card__delta">Peak transaction amount</div>
                        </Card>
                        <Card tone="muted" padding="sm">
                            <div className="stat-card__label">Transactions</div>
                            <div className="stat-card__value">{formatAmount(summary.activity)}</div>
                            <div className="stat-card__delta">High-value transfers processed</div>
                        </Card>
                    </section>

                    <div className={styles.chart_container}>
                        {loading && !series.length ? (
                            <Skeleton style={{ height: '240px' }} />
                        ) : (
                            <LineChart
                                series={[
                                    {
                                        id: 'whales-volume',
                                        label: 'TRX moved',
                                        data: series,
                                        color: '#7C9BFF'
                                    }
                                ]}
                                yAxisFormatter={value => `${Math.round(value).toLocaleString()}`}
                                emptyLabel="No whale transactions recorded during this range."
                            />
                        )}
                    </div>

                    {error && <p className={styles.error_message}>{error}</p>}
                </Stack>
            </Card>

            <Card>
                <Stack>
                    <header className={styles.highlights_header}>
                        <div>
                            <h3 className={styles.highlights_header__title}>Latest whale transfers</h3>
                            <p className={styles.highlights_header__description}>Sorted by most recent activity.</p>
                        </div>
                        <Badge tone="neutral">{highlights.length} events</Badge>
                    </header>
                    <div className={styles.highlights_list}>
                        {highlights.map(item => (
                            <article key={item.txId} className={styles.highlight}>
                                <div className={styles.highlight__header}>
                                    <strong className={styles.highlight__amount}>
                                        {formatAmount(item.amountTRX)} TRX
                                    </strong>
                                    <span className={styles.highlight__timestamp}>
                                        {new Date(item.timestamp).toLocaleString()}
                                    </span>
                                </div>
                                <div className={styles.highlight__addresses}>
                                    {item.fromAddress} → {item.toAddress}
                                </div>
                                {item.memo && <p className={styles.highlight__memo}>{item.memo}</p>}
                            </article>
                        ))}
                        {!highlights.length && (
                            <p className={styles.empty_state}>No whale movements recorded yet.</p>
                        )}
                    </div>
                </Stack>
            </Card>
        </div>
    );
}
