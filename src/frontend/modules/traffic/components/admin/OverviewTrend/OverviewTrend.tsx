/**
 * OverviewTrend Component
 *
 * The unified dashboard headline every analytics platform leads with: a KPI
 * strip (Unique Visitors, Pageviews, Views / Visit, Bounce Rate, Visit
 * Duration) with period-over-period deltas, above a single large time-series
 * whose metric switches when a clickable KPI is selected.
 *
 * Buckets are hourly for windows ≤ 48h and daily otherwise (decided
 * server-side), zero-filled so quiet periods read as flat lines rather than
 * missing segments. Bounce Rate and Visit Duration depend on session events
 * that are not yet emitted (Phase D) — until then they render as "—" with an
 * annotation instead of false zeros.
 */

'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { LineChart } from '../../../../../features/charts/components/LineChart';
import type { ChartSeries } from '../../../../../features/charts/components/LineChart';
import { Card } from '../../../../../components/ui/Card';
import { adminGetOverviewTrend } from '../../../api';
import type { AnalyticsPeriod, ICustomDateRange, IOverviewTrend } from '../../../api';
import styles from './OverviewTrend.module.scss';

/** Chart-switchable metrics. */
type TrendMetric = 'visitors' | 'pageviews';

/**
 * Resolve a CSS variable to its computed value with an SSR-safe fallback.
 *
 * @param varName - CSS variable name (e.g. '--color-primary')
 * @param fallback - Hex fallback when document is unavailable
 * @returns Resolved color string
 */
function resolveCSSColor(varName: string, fallback: string): string {
    if (typeof document === 'undefined') return fallback;
    const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return value || fallback;
}

/**
 * Format milliseconds into a compact human duration ("45s", "2m 30s").
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted duration string
 */
function formatDurationMs(ms: number): string {
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    const hours = Math.floor(minutes / 60);
    const remaining = minutes % 60;
    return remaining > 0 ? `${hours}h ${remaining}m` : `${hours}h`;
}

/**
 * Percentage change of `current` vs `previous`. A zero previous window with
 * current activity reads as +100% rather than infinity.
 *
 * @param current - Current-window value
 * @param previous - Previous-window value
 * @returns Signed percentage change, or null when both windows are zero
 */
function percentChange(current: number, previous: number): number | null {
    if (previous === 0 && current === 0) return null;
    if (previous === 0) return 100;
    return ((current - previous) / previous) * 100;
}

interface IDeltaProps {
    /** Signed percentage change, or null for no movement to report. */
    change: number | null;
    /** Invert color semantics (down = good), e.g. bounce rate. */
    invert?: boolean;
}

/**
 * Render a period-over-period delta with directional arrow and tone.
 *
 * @param props - The percentage change and color semantics.
 * @returns The delta indicator, or a flat dash when there is no movement.
 */
function Delta({ change, invert = false }: IDeltaProps) {
    if (change === null) {
        return <span className={styles.delta_flat}><Minus size={14} aria-hidden="true" /></span>;
    }
    const rounded = Math.round(change);
    if (rounded === 0) {
        return <span className={styles.delta_flat}><Minus size={14} aria-hidden="true" /> 0%</span>;
    }
    const up = rounded > 0;
    const good = invert ? !up : up;
    return (
        <span className={good ? styles.delta_good : styles.delta_bad}>
            {up
                ? <ArrowUpRight size={14} aria-hidden="true" />
                : <ArrowDownRight size={14} aria-hidden="true" />}
            {Math.abs(rounded)}%
            <span className={styles.sr_only}>{up ? 'increase' : 'decrease'} vs previous period</span>
        </span>
    );
}

interface IOverviewTrendProps {
    /** Selected lookback period. */
    period: AnalyticsPeriod;
    /** Custom date range when `period === 'custom'`. */
    customRange?: ICustomDateRange;
    /** Whether classified bot rows are included. */
    includeBots: boolean;
}

/**
 * KPI strip + unified trend chart for the Analytics tab.
 *
 * @param props - Global period/bot-filter selection from the page controls.
 * @returns The rendered overview headline.
 */
export function OverviewTrend({ period, customRange, includeBots }: IOverviewTrendProps) {
    const [trend, setTrend] = useState<IOverviewTrend | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [metric, setMetric] = useState<TrendMetric>('visitors');
    // Stale-while-revalidate: previous data stays visible during a window
    // change, dimmed via this flag so the refresh is perceptible.
    const [isFetching, setIsFetching] = useState(true);

    useEffect(() => {
        let active = true;
        setIsFetching(true);
        adminGetOverviewTrend(period, customRange, !includeBots)
            .then(data => { if (active) { setTrend(data); setError(null); } })
            .catch(err => { if (active) setError(err instanceof Error ? err.message : 'Failed to load'); })
            .finally(() => { if (active) setIsFetching(false); });
        return () => { active = false; };
    }, [period, customRange, includeBots]);

    const series: ChartSeries[] = useMemo(() => {
        if (!trend || trend.series.length === 0) return [];
        return [{
            id: metric,
            label: metric === 'visitors' ? 'Unique Visitors' : 'Pageviews',
            color: metric === 'visitors'
                ? resolveCSSColor('--color-primary', '#4b8cff')
                : resolveCSSColor('--color-success', '#57d48c'),
            fill: true,
            data: trend.series.map(p => ({ date: p.bucket, value: p[metric] }))
        }];
    }, [trend, metric]);

    if (error) {
        return <Card padding="md"><p className={styles.error}>{error}</p></Card>;
    }
    if (!trend) {
        return <Card padding="md"><p className={styles.loading}>Loading overview…</p></Card>;
    }

    const { current, previous } = trend;
    const sessionsAvailable = current.sessions > 0 || previous.sessions > 0;
    const viewsPerVisit = current.visitors > 0 ? current.pageviews / current.visitors : 0;
    const prevViewsPerVisit = previous.visitors > 0 ? previous.pageviews / previous.visitors : 0;
    const numberFormatter = new Intl.NumberFormat();

    return (
        <Card padding="md" className={isFetching ? `${styles.container} ${styles.container_fetching}` : styles.container} aria-busy={isFetching}>
            <div className={styles.kpi_strip} role="group" aria-label="Headline metrics">
                <button
                    type="button"
                    className={metric === 'visitors' ? styles.kpi_active : styles.kpi}
                    onClick={() => setMetric('visitors')}
                    aria-pressed={metric === 'visitors'}
                    title={includeBots
                        ? 'Cookieless bots mint a fresh visitor id per request, so with bots included this approximates total requests, not people'
                        : 'Distinct visitor ids (per-browser cookie): cookie clearing and multiple devices count the same person again'}
                >
                    <span className={styles.kpi_label}>
                        {includeBots ? 'Unique Visitors (incl. bot requests)' : 'Unique Visitors'}
                    </span>
                    <span className={styles.kpi_value}>{numberFormatter.format(current.visitors)}</span>
                    <Delta change={percentChange(current.visitors, previous.visitors)} />
                </button>
                {includeBots && (
                    <div
                        className={styles.kpi_static}
                        title="Distinct visitor ids split by bot classification. Bot ids approximate requests — cookieless bots mint a fresh id per hit — so the two sides are not comparable units. Delta tracks the human side."
                    >
                        <span className={styles.kpi_label}>Human / Bot Split</span>
                        <span className={styles.kpi_value}>
                            {numberFormatter.format(current.humanVisitors ?? 0)} / {numberFormatter.format(current.botVisitors ?? 0)}
                        </span>
                        <Delta change={percentChange(current.humanVisitors ?? 0, previous.humanVisitors ?? 0)} />
                    </div>
                )}
                <button
                    type="button"
                    className={metric === 'pageviews' ? styles.kpi_active : styles.kpi}
                    onClick={() => setMetric('pageviews')}
                    aria-pressed={metric === 'pageviews'}
                >
                    <span className={styles.kpi_label}>Pageviews</span>
                    <span className={styles.kpi_value}>{numberFormatter.format(current.pageviews)}</span>
                    <Delta change={percentChange(current.pageviews, previous.pageviews)} />
                </button>
                <div className={styles.kpi_static}>
                    <span className={styles.kpi_label}>Views / Visit</span>
                    <span className={styles.kpi_value}>{viewsPerVisit.toFixed(1)}</span>
                    <Delta change={percentChange(viewsPerVisit, prevViewsPerVisit)} />
                </div>
                <div
                    className={styles.kpi_static}
                    title="Single-page sessions / sessions (derived, 30-minute inactivity rule)"
                >
                    <span className={styles.kpi_label}>Bounce Rate</span>
                    <span className={styles.kpi_value}>
                        {sessionsAvailable ? `${Math.round(current.bounceRate * 100)}%` : '—'}
                    </span>
                    {sessionsAvailable
                        ? <Delta change={percentChange(current.bounceRate, previous.bounceRate)} invert />
                        : <span className={styles.kpi_note}>no sessions in window</span>}
                </div>
                <div
                    className={styles.kpi_static}
                    title="Average derived-session duration (last hit minus first hit)"
                >
                    <span className={styles.kpi_label}>Visit Duration</span>
                    <span className={styles.kpi_value}>
                        {sessionsAvailable ? formatDurationMs(current.avgDurationMs) : '—'}
                    </span>
                    {sessionsAvailable
                        ? <Delta change={percentChange(current.avgDurationMs, previous.avgDurationMs)} />
                        : <span className={styles.kpi_note}>no sessions in window</span>}
                </div>
            </div>

            <LineChart
                series={series}
                height={280}
                yAxisMin={0}
                yAxisFormatter={(v) => numberFormatter.format(Math.round(v))}
                emptyLabel="No traffic recorded in this period."
            />
            <p className={styles.footnote}>
                {trend.granularity === 'hour' ? 'Hourly' : 'Daily'} buckets · deltas compare the
                equal-length previous period · sessions derived from page events (30-minute inactivity rule).
            </p>
        </Card>
    );
}
