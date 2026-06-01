/**
 * VisitorAnalytics Component
 *
 * Admin analytics displaying daily visitor trends and the anonymous
 * first-touches table.
 *
 * Renders two sections:
 * 1. Daily visitors chart with 30d/90d toggle
 * 2. Anonymous first touches table — the earliest cookieless `bootstrap` row
 *    for each visitor in the window, newest first. Recorded server-side by the
 *    Next.js middleware, so it deliberately includes bots, crawlers, and
 *    unfurlers alongside humans; that first-touch noise is itself the signal.
 *    Per-page clickstream for cookied (tid) and registered (user_id) visitors
 *    lives in the sibling PageActivity sections.
 */

'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { LineChart } from '../../../../../features/charts/components/LineChart';
import type { ChartSeries } from '../../../../../features/charts/components/LineChart';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { Button } from '../../../../../components/ui/Button';
import {
    adminGetDailyVisitors,
    adminGetAnonymousFirstTouches
} from '../../../api';
import type { IDailyVisitorData, IVisitorOrigin, VisitorPeriod } from '../../../api';
import { getDeviceIcon } from '../../../lib/deviceIcon';
import styles from './VisitorAnalytics.module.scss';

/**
 * Resolve a CSS variable to its computed hex value.
 *
 * @param varName - CSS variable name
 * @param fallback - Hex fallback for SSR
 * @returns Resolved hex color string
 */
function resolveCSSColor(varName: string, fallback: string): string {
    if (typeof document === 'undefined') return fallback;
    const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return value || fallback;
}

/**
 * Format UTM parameters into a readable summary string.
 *
 * @param utm - UTM parameters object or null
 * @returns Formatted string like "google / cpc / spring_sale" or null
 */
function formatUtm(utm: IVisitorOrigin['utm']): string | null {
    if (!utm) {
        return null;
    }

    const parts = [utm.source, utm.medium, utm.campaign].filter(Boolean);

    return parts.length > 0 ? parts.join(' / ') : null;
}

/** Available chart range options. */
type ChartRange = '30d' | '90d';

/** Period option labels for display. */
const PERIOD_LABELS: Record<VisitorPeriod, string> = {
    '24h': '24 Hours',
    '7d': '7 Days',
    '30d': '30 Days',
    '90d': '90 Days'
};

interface Props {
    token: string;
}

/**
 * VisitorAnalytics displays aggregate visitor analytics for the admin dashboard.
 *
 * Includes a daily visitor trend chart (30d/90d) and an anonymous first-touches
 * table showing first-touch acquisition data (original referrer, landing page,
 * country, device, UTM) for SEO and marketing analysis.
 *
 * @param props - Component props
 * @param props.token - Admin authentication token for API requests
 */
export function VisitorAnalytics({ token }: Props) {
    const [chartRange, setChartRange] = useState<ChartRange>('30d');
    const [chartData, setChartData] = useState<IDailyVisitorData[]>([]);
    const [chartLoading, setChartLoading] = useState(true);

    const [firstTouchesPeriod, setFirstTouchesPeriod] = useState<VisitorPeriod>('24h');
    const [firstTouches, setFirstTouches] = useState<IVisitorOrigin[]>([]);
    const [firstTouchesTotal, setFirstTouchesTotal] = useState(0);
    const [firstTouchesLoading, setFirstTouchesLoading] = useState(true);
    const [firstTouchesPage, setFirstTouchesPage] = useState(1);
    const firstTouchesLimit = 25;

    /**
     * Fetch daily visitor chart data using typed API client.
     */
    const fetchChartData = useCallback(async () => {
        setChartLoading(true);
        try {
            const days = chartRange === '30d' ? 30 : 90;
            const data = await adminGetDailyVisitors(token, days);
            setChartData(data);
        } catch (error) {
            console.error('Failed to fetch daily visitors:', error);
            setChartData([]);
        } finally {
            setChartLoading(false);
        }
    }, [token, chartRange]);

    /**
     * Fetch anonymous first touches using typed API client.
     */
    const fetchFirstTouches = useCallback(async () => {
        setFirstTouchesLoading(true);
        try {
            const result = await adminGetAnonymousFirstTouches(token, {
                period: firstTouchesPeriod,
                limit: firstTouchesLimit,
                skip: (firstTouchesPage - 1) * firstTouchesLimit
            });
            setFirstTouches(result.visitors ?? []);
            setFirstTouchesTotal(result.total ?? 0);
        } catch (error) {
            console.error('Failed to fetch anonymous first touches:', error);
            setFirstTouches([]);
            setFirstTouchesTotal(0);
        } finally {
            setFirstTouchesLoading(false);
        }
    }, [token, firstTouchesPeriod, firstTouchesPage]);

    useEffect(() => { fetchChartData(); }, [fetchChartData]);
    useEffect(() => { fetchFirstTouches(); }, [fetchFirstTouches]);

    /**
     * Build chart series from daily visitor data.
     */
    const chartSeries: ChartSeries[] = chartData.length > 0
        ? [{
            id: 'daily-visitors',
            label: 'Unique Visitors',
            data: chartData.map(d => ({
                date: d.date,
                value: d.count
            })),
            color: resolveCSSColor('--color-primary', '#4b8cff'),
            fill: true
        }]
        : [];

    const chartDays = chartRange === '30d' ? 30 : 90;
    const minDate = new Date();
    minDate.setDate(minDate.getDate() - chartDays);
    minDate.setHours(0, 0, 0, 0);

    const totalFirstTouchesPages = firstTouchesTotal > 0 ? Math.ceil(firstTouchesTotal / firstTouchesLimit) : 1;

    /**
     * Handle period change and reset pagination for first touches.
     *
     * @param period - The new period to filter by
     */
    const handleFirstTouchesPeriodChange = (period: VisitorPeriod): void => {
        setFirstTouchesPeriod(period);
        setFirstTouchesPage(1);
    };

    return (
        <div className={styles.container}>
            {/* Daily Visitors Chart */}
            <div className={styles.section}>
                <div className={styles.section_header}>
                    <h2 className={styles.section_title}>Daily Visitors</h2>
                    <div className={styles.toggle_group} role="group" aria-label="Chart range">
                        <button
                            className={`${styles.toggle_btn} ${chartRange === '30d' ? styles.toggle_btn__active : ''}`}
                            onClick={() => setChartRange('30d')}
                            aria-pressed={chartRange === '30d'}
                        >
                            30 Days
                        </button>
                        <button
                            className={`${styles.toggle_btn} ${chartRange === '90d' ? styles.toggle_btn__active : ''}`}
                            onClick={() => setChartRange('90d')}
                            aria-pressed={chartRange === '90d'}
                        >
                            90 Days
                        </button>
                    </div>
                </div>
                <div className={styles.chart_wrapper}>
                    {chartLoading ? (
                        <div className={styles.loading}>Loading chart data...</div>
                    ) : (
                        <LineChart
                            series={chartSeries}
                            height={320}
                            minDate={minDate}
                            maxDate={new Date()}
                            yAxisMin={0}
                            yAxisFormatter={val => Math.round(val).toLocaleString()}
                            emptyLabel="No visitor data available for this period."
                        />
                    )}
                </div>
            </div>

            {/* Anonymous First Touches Table */}
            <div className={styles.section}>
                <div className={styles.section_header}>
                    <h2 className={styles.section_title}>Anonymous First Touches</h2>
                    <div className={styles.toggle_group} role="group" aria-label="Anonymous first touches time period">
                        {(Object.keys(PERIOD_LABELS) as VisitorPeriod[]).map(period => (
                            <button
                                key={period}
                                className={`${styles.toggle_btn} ${firstTouchesPeriod === period ? styles.toggle_btn__active : ''}`}
                                onClick={() => handleFirstTouchesPeriodChange(period)}
                                aria-pressed={firstTouchesPeriod === period}
                            >
                                {PERIOD_LABELS[period]}
                            </button>
                        ))}
                    </div>
                </div>
                <p className="text-muted">
                    The first cookieless hit per visitor — server-recorded, so bots and crawlers
                    are included by design. Per-page activity for cookied and registered visitors
                    is in the sections below.
                </p>

                {firstTouchesLoading ? (
                    <div className={styles.loading}>Loading first touches...</div>
                ) : firstTouches.length === 0 ? (
                    <div className={styles.empty}>No anonymous first touches found in this period.</div>
                ) : (
                    <>
                        <div className={styles.table_wrapper}>
                            <table className={styles.table}>
                                <thead>
                                    <tr>
                                        <th>First Seen</th>
                                        <th>Country</th>
                                        <th>Original Referrer</th>
                                        <th>Landing Page</th>
                                        <th>UTM</th>
                                        <th>Device</th>
                                        <th>Total Views</th>
                                        <th>Total Sessions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {firstTouches.map(touch => {
                                        const utmDisplay = formatUtm(touch.utm);

                                        return (
                                            <tr key={touch.userId}>
                                                <td>
                                                    <ClientTime date={touch.firstSeen} format="relative" />
                                                </td>
                                                <td className={styles.country_cell}>
                                                    {touch.country || <span className={styles.muted}>—</span>}
                                                </td>
                                                <td className={styles.referrer_cell} title={touch.referrerDomain ?? undefined}>
                                                    {touch.referrerDomain || <span className={styles.muted}>direct</span>}
                                                </td>
                                                <td className={styles.landing_cell} title={touch.landingPage ?? undefined}>
                                                    {touch.landingPage || <span className={styles.muted}>—</span>}
                                                </td>
                                                <td className={styles.utm_cell} title={utmDisplay ?? undefined}>
                                                    {utmDisplay || <span className={styles.muted}>—</span>}
                                                </td>
                                                <td className={styles.device_cell}>
                                                    {getDeviceIcon(touch.device)}
                                                </td>
                                                <td>{touch.pageViews.toLocaleString()}</td>
                                                <td>{touch.sessionsCount.toLocaleString()}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        <div className={styles.pagination}>
                            <Button
                                onClick={() => setFirstTouchesPage(firstTouchesPage - 1)}
                                disabled={firstTouchesPage <= 1}
                                size="sm"
                                variant="ghost"
                            >
                                Previous
                            </Button>
                            <span className={styles.page_info}>
                                Page {firstTouchesPage} of {totalFirstTouchesPages} ({firstTouchesTotal.toLocaleString()} first touches)
                            </span>
                            <Button
                                onClick={() => setFirstTouchesPage(firstTouchesPage + 1)}
                                disabled={firstTouchesPage >= totalFirstTouchesPages}
                                size="sm"
                                variant="ghost"
                            >
                                Next
                            </Button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
