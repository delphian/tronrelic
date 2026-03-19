/**
 * VisitorAnalytics Component
 *
 * Admin analytics dashboard displaying daily visitor trends and a recent
 * visitors list with referrer, country, and landing page data for SEO analysis.
 *
 * Renders two sections:
 * 1. Daily visitors chart with 30d/90d toggle
 * 2. Recent visitors table with selectable time period (24h, 7d, 30d, 90d)
 */

'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Smartphone, Tablet, Monitor, HelpCircle } from 'lucide-react';
import { LineChart } from '../../../../../features/charts/components/LineChart';
import type { ChartSeries } from '../../../../../features/charts/components/LineChart';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { Button } from '../../../../../components/ui/Button';
import { config as runtimeConfig } from '../../../../../lib/config';
import type { IDailyVisitorData, IRecentVisitor } from '../../../api';
import styles from './VisitorAnalytics.module.scss';

/** Device icon size for inline table display. */
const DEVICE_ICON_SIZE = 14;

/**
 * Get device icon for display in the visitors table.
 *
 * @param device - Device category string
 * @returns JSX element for the device icon
 */
function getDeviceIcon(device: string): JSX.Element {
    switch (device) {
        case 'mobile': return <Smartphone size={DEVICE_ICON_SIZE} aria-label="Mobile device" />;
        case 'tablet': return <Tablet size={DEVICE_ICON_SIZE} aria-label="Tablet device" />;
        case 'desktop': return <Monitor size={DEVICE_ICON_SIZE} aria-label="Desktop device" />;
        default: return <HelpCircle size={DEVICE_ICON_SIZE} aria-label="Unknown device" />;
    }
}

/** Available chart range options. */
type ChartRange = '30d' | '90d';

/** Available period options for recent visitors. */
type VisitorPeriod = '24h' | '7d' | '30d' | '90d';

/** Period option labels for display. */
const PERIOD_LABELS: Record<VisitorPeriod, string> = {
    '24h': '24 Hours',
    '7d': '7 Days',
    '30d': '30 Days',
    '90d': '90 Days'
};

/** Admin API header key. */
const ADMIN_HEADER_KEY = 'x-admin-token';

interface Props {
    token: string;
}

/**
 * VisitorAnalytics displays aggregate visitor analytics for the admin dashboard.
 *
 * Includes a daily visitor trend chart (30d/90d) and a recent visitors table
 * with country, referrer domain, and landing page for SEO analysis.
 *
 * @param props - Component props
 * @param props.token - Admin authentication token for API requests
 */
export function VisitorAnalytics({ token }: Props) {
    const [chartRange, setChartRange] = useState<ChartRange>('30d');
    const [chartData, setChartData] = useState<IDailyVisitorData[]>([]);
    const [chartLoading, setChartLoading] = useState(true);

    const [visitorPeriod, setVisitorPeriod] = useState<VisitorPeriod>('24h');
    const [visitors, setVisitors] = useState<IRecentVisitor[]>([]);
    const [visitorsTotal, setVisitorsTotal] = useState(0);
    const [visitorsLoading, setVisitorsLoading] = useState(true);
    const [visitorsPage, setVisitorsPage] = useState(1);
    const visitorsLimit = 25;

    /**
     * Fetch daily visitor chart data from the analytics endpoint.
     */
    const fetchChartData = useCallback(async () => {
        setChartLoading(true);
        try {
            const days = chartRange === '30d' ? 30 : 90;
            const response = await fetch(
                `${runtimeConfig.apiBaseUrl}/admin/users/analytics/daily-visitors?days=${days}`,
                { headers: { [ADMIN_HEADER_KEY]: token } }
            );

            if (!response.ok) {
                throw new Error(`Failed to fetch chart data: ${response.status}`);
            }

            const result = await response.json();
            setChartData(result.data ?? []);
        } catch (error) {
            console.error('Failed to fetch daily visitors:', error);
            setChartData([]);
        } finally {
            setChartLoading(false);
        }
    }, [token, chartRange]);

    /**
     * Fetch recent visitors list from the analytics endpoint.
     */
    const fetchVisitors = useCallback(async () => {
        setVisitorsLoading(true);
        try {
            const params = new URLSearchParams();
            params.set('period', visitorPeriod);
            params.set('limit', visitorsLimit.toString());
            params.set('skip', ((visitorsPage - 1) * visitorsLimit).toString());

            const response = await fetch(
                `${runtimeConfig.apiBaseUrl}/admin/users/analytics/recent-visitors?${params.toString()}`,
                { headers: { [ADMIN_HEADER_KEY]: token } }
            );

            if (!response.ok) {
                throw new Error(`Failed to fetch visitors: ${response.status}`);
            }

            const result = await response.json();
            setVisitors(result.visitors ?? []);
            setVisitorsTotal(result.total ?? 0);
        } catch (error) {
            console.error('Failed to fetch recent visitors:', error);
            setVisitors([]);
            setVisitorsTotal(0);
        } finally {
            setVisitorsLoading(false);
        }
    }, [token, visitorPeriod, visitorsPage]);

    useEffect(() => { fetchChartData(); }, [fetchChartData]);
    useEffect(() => { fetchVisitors(); }, [fetchVisitors]);

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
            color: '#7C9BFF',
            fill: true
        }]
        : [];

    const chartDays = chartRange === '30d' ? 30 : 90;
    const minDate = new Date();
    minDate.setDate(minDate.getDate() - chartDays);
    minDate.setHours(0, 0, 0, 0);

    const totalVisitorPages = visitorsTotal > 0 ? Math.ceil(visitorsTotal / visitorsLimit) : 1;

    /**
     * Handle period change and reset pagination.
     *
     * @param period - The new visitor period to filter by
     */
    const handlePeriodChange = (period: VisitorPeriod): void => {
        setVisitorPeriod(period);
        setVisitorsPage(1);
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

            {/* Recent Visitors Table */}
            <div className={styles.section}>
                <div className={styles.section_header}>
                    <h2 className={styles.section_title}>Recent Visitors</h2>
                    <div className={styles.toggle_group} role="group" aria-label="Time period">
                        {(Object.keys(PERIOD_LABELS) as VisitorPeriod[]).map(period => (
                            <button
                                key={period}
                                className={`${styles.toggle_btn} ${visitorPeriod === period ? styles.toggle_btn__active : ''}`}
                                onClick={() => handlePeriodChange(period)}
                                aria-pressed={visitorPeriod === period}
                            >
                                {PERIOD_LABELS[period]}
                            </button>
                        ))}
                    </div>
                </div>

                {visitorsLoading ? (
                    <div className={styles.loading}>Loading visitors...</div>
                ) : visitors.length === 0 ? (
                    <div className={styles.empty}>No visitors found in this period.</div>
                ) : (
                    <>
                        <div className={styles.table_wrapper}>
                            <table className={styles.table}>
                                <thead>
                                    <tr>
                                        <th>Last Seen</th>
                                        <th>Country</th>
                                        <th>Referrer</th>
                                        <th>Landing Page</th>
                                        <th>Device</th>
                                        <th>Views</th>
                                        <th>Sessions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {visitors.map(visitor => (
                                        <tr key={visitor.userId}>
                                            <td>
                                                <ClientTime date={visitor.lastSeen} format="relative" />
                                            </td>
                                            <td className={styles.country_cell}>
                                                {visitor.country || <span className={styles.muted}>—</span>}
                                            </td>
                                            <td className={styles.referrer_cell} title={visitor.referrerDomain ?? undefined}>
                                                {visitor.referrerDomain || <span className={styles.muted}>direct</span>}
                                            </td>
                                            <td className={styles.landing_cell} title={visitor.landingPage ?? undefined}>
                                                {visitor.landingPage || <span className={styles.muted}>—</span>}
                                            </td>
                                            <td className={styles.device_cell}>
                                                {getDeviceIcon(visitor.device)}
                                            </td>
                                            <td>{visitor.pageViews.toLocaleString()}</td>
                                            <td>{visitor.sessionsCount.toLocaleString()}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className={styles.pagination}>
                            <Button
                                onClick={() => setVisitorsPage(visitorsPage - 1)}
                                disabled={visitorsPage <= 1}
                                size="sm"
                                variant="ghost"
                            >
                                Previous
                            </Button>
                            <span className={styles.page_info}>
                                Page {visitorsPage} of {totalVisitorPages} ({visitorsTotal.toLocaleString()} visitors)
                            </span>
                            <Button
                                onClick={() => setVisitorsPage(visitorsPage + 1)}
                                disabled={visitorsPage >= totalVisitorPages}
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
