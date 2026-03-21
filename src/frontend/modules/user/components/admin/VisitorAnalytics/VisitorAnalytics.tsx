/**
 * VisitorAnalytics Component
 *
 * Admin analytics dashboard displaying daily visitor trends, a traffic
 * origins table, and a new users table.
 *
 * Renders three sections:
 * 1. Daily visitors chart with 30d/90d toggle
 * 2. Traffic origins table showing first-session acquisition data per visitor
 * 3. New users table showing recently arrived users sorted by first seen date
 */

'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Smartphone, Tablet, Monitor, HelpCircle } from 'lucide-react';
import { LineChart } from '../../../../../features/charts/components/LineChart';
import type { ChartSeries } from '../../../../../features/charts/components/LineChart';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { Button } from '../../../../../components/ui/Button';
import { config as runtimeConfig } from '../../../../../lib/config';
import type { IDailyVisitorData, IVisitorOrigin, VisitorPeriod } from '../../../api';
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

/** Admin API header key. */
const ADMIN_HEADER_KEY = 'x-admin-token';

interface Props {
    token: string;
}

/**
 * VisitorAnalytics displays aggregate visitor analytics for the admin dashboard.
 *
 * Includes a daily visitor trend chart (30d/90d) and a traffic origins table
 * showing first-session acquisition data (original referrer, landing page,
 * country, device, UTM) for SEO and marketing analysis.
 *
 * @param props - Component props
 * @param props.token - Admin authentication token for API requests
 */
export function VisitorAnalytics({ token }: Props) {
    const [chartRange, setChartRange] = useState<ChartRange>('30d');
    const [chartData, setChartData] = useState<IDailyVisitorData[]>([]);
    const [chartLoading, setChartLoading] = useState(true);

    const [visitorPeriod, setVisitorPeriod] = useState<VisitorPeriod>('24h');
    const [visitors, setVisitors] = useState<IVisitorOrigin[]>([]);
    const [visitorsTotal, setVisitorsTotal] = useState(0);
    const [visitorsLoading, setVisitorsLoading] = useState(true);
    const [visitorsPage, setVisitorsPage] = useState(1);
    const visitorsLimit = 25;

    const [newUsersPeriod, setNewUsersPeriod] = useState<VisitorPeriod>('24h');
    const [newUsers, setNewUsers] = useState<IVisitorOrigin[]>([]);
    const [newUsersTotal, setNewUsersTotal] = useState(0);
    const [newUsersLoading, setNewUsersLoading] = useState(true);
    const [newUsersPage, setNewUsersPage] = useState(1);
    const newUsersLimit = 25;

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
     * Fetch visitor origins from the analytics endpoint.
     */
    const fetchVisitors = useCallback(async () => {
        setVisitorsLoading(true);
        try {
            const params = new URLSearchParams();
            params.set('period', visitorPeriod);
            params.set('limit', visitorsLimit.toString());
            params.set('skip', ((visitorsPage - 1) * visitorsLimit).toString());

            const response = await fetch(
                `${runtimeConfig.apiBaseUrl}/admin/users/analytics/visitor-origins?${params.toString()}`,
                { headers: { [ADMIN_HEADER_KEY]: token } }
            );

            if (!response.ok) {
                throw new Error(`Failed to fetch visitor origins: ${response.status}`);
            }

            const result = await response.json();
            setVisitors(result.visitors ?? []);
            setVisitorsTotal(result.total ?? 0);
        } catch (error) {
            console.error('Failed to fetch visitor origins:', error);
            setVisitors([]);
            setVisitorsTotal(0);
        } finally {
            setVisitorsLoading(false);
        }
    }, [token, visitorPeriod, visitorsPage]);

    /**
     * Fetch new users from the analytics endpoint.
     */
    const fetchNewUsers = useCallback(async () => {
        setNewUsersLoading(true);
        try {
            const params = new URLSearchParams();
            params.set('period', newUsersPeriod);
            params.set('limit', newUsersLimit.toString());
            params.set('skip', ((newUsersPage - 1) * newUsersLimit).toString());

            const response = await fetch(
                `${runtimeConfig.apiBaseUrl}/admin/users/analytics/new-users?${params.toString()}`,
                { headers: { [ADMIN_HEADER_KEY]: token } }
            );

            if (!response.ok) {
                throw new Error(`Failed to fetch new users: ${response.status}`);
            }

            const result = await response.json();
            setNewUsers(result.visitors ?? []);
            setNewUsersTotal(result.total ?? 0);
        } catch (error) {
            console.error('Failed to fetch new users:', error);
            setNewUsers([]);
            setNewUsersTotal(0);
        } finally {
            setNewUsersLoading(false);
        }
    }, [token, newUsersPeriod, newUsersPage]);

    useEffect(() => { fetchChartData(); }, [fetchChartData]);
    useEffect(() => { fetchVisitors(); }, [fetchVisitors]);
    useEffect(() => { fetchNewUsers(); }, [fetchNewUsers]);

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
    const totalNewUsersPages = newUsersTotal > 0 ? Math.ceil(newUsersTotal / newUsersLimit) : 1;

    /**
     * Handle period change and reset pagination for traffic origins.
     *
     * @param period - The new visitor period to filter by
     */
    const handlePeriodChange = (period: VisitorPeriod): void => {
        setVisitorPeriod(period);
        setVisitorsPage(1);
    };

    /**
     * Handle period change and reset pagination for new users.
     *
     * @param period - The new period to filter by
     */
    const handleNewUsersPeriodChange = (period: VisitorPeriod): void => {
        setNewUsersPeriod(period);
        setNewUsersPage(1);
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

            {/* Traffic Origins Table */}
            <div className={styles.section}>
                <div className={styles.section_header}>
                    <h2 className={styles.section_title}>Traffic Origins</h2>
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
                    <div className={styles.loading}>Loading visitor origins...</div>
                ) : visitors.length === 0 ? (
                    <div className={styles.empty}>No visitors found in this period.</div>
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
                                    {visitors.map(visitor => {
                                        const utmDisplay = formatUtm(visitor.utm);

                                        return (
                                            <tr key={visitor.userId}>
                                                <td>
                                                    <ClientTime date={visitor.firstSeen} format="relative" />
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
                                                <td className={styles.utm_cell} title={utmDisplay ?? undefined}>
                                                    {utmDisplay || <span className={styles.muted}>—</span>}
                                                </td>
                                                <td className={styles.device_cell}>
                                                    {getDeviceIcon(visitor.device)}
                                                </td>
                                                <td>{visitor.pageViews.toLocaleString()}</td>
                                                <td>{visitor.sessionsCount.toLocaleString()}</td>
                                            </tr>
                                        );
                                    })}
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

            {/* New Users Table */}
            <div className={styles.section}>
                <div className={styles.section_header}>
                    <h2 className={styles.section_title}>New Users</h2>
                    <div className={styles.toggle_group} role="group" aria-label="New users time period">
                        {(Object.keys(PERIOD_LABELS) as VisitorPeriod[]).map(period => (
                            <button
                                key={period}
                                className={`${styles.toggle_btn} ${newUsersPeriod === period ? styles.toggle_btn__active : ''}`}
                                onClick={() => handleNewUsersPeriodChange(period)}
                                aria-pressed={newUsersPeriod === period}
                            >
                                {PERIOD_LABELS[period]}
                            </button>
                        ))}
                    </div>
                </div>

                {newUsersLoading ? (
                    <div className={styles.loading}>Loading new users...</div>
                ) : newUsers.length === 0 ? (
                    <div className={styles.empty}>No new users found in this period.</div>
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
                                    {newUsers.map(user => {
                                        const utmDisplay = formatUtm(user.utm);

                                        return (
                                            <tr key={user.userId}>
                                                <td>
                                                    <ClientTime date={user.firstSeen} format="relative" />
                                                </td>
                                                <td className={styles.country_cell}>
                                                    {user.country || <span className={styles.muted}>—</span>}
                                                </td>
                                                <td className={styles.referrer_cell} title={user.referrerDomain ?? undefined}>
                                                    {user.referrerDomain || <span className={styles.muted}>direct</span>}
                                                </td>
                                                <td className={styles.landing_cell} title={user.landingPage ?? undefined}>
                                                    {user.landingPage || <span className={styles.muted}>—</span>}
                                                </td>
                                                <td className={styles.utm_cell} title={utmDisplay ?? undefined}>
                                                    {utmDisplay || <span className={styles.muted}>—</span>}
                                                </td>
                                                <td className={styles.device_cell}>
                                                    {getDeviceIcon(user.device)}
                                                </td>
                                                <td>{user.pageViews.toLocaleString()}</td>
                                                <td>{user.sessionsCount.toLocaleString()}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        <div className={styles.pagination}>
                            <Button
                                onClick={() => setNewUsersPage(newUsersPage - 1)}
                                disabled={newUsersPage <= 1}
                                size="sm"
                                variant="ghost"
                            >
                                Previous
                            </Button>
                            <span className={styles.page_info}>
                                Page {newUsersPage} of {totalNewUsersPages} ({newUsersTotal.toLocaleString()} new users)
                            </span>
                            <Button
                                onClick={() => setNewUsersPage(newUsersPage + 1)}
                                disabled={newUsersPage >= totalNewUsersPages}
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
