'use client';

import { useEffect, useState, useMemo } from 'react';
import type { IFrontendPluginContext } from '@tronrelic/types';
import { Activity, AlertCircle } from 'lucide-react';
import styles from './ResourceTrackingPage.module.css';
import { ResourceDelegationsCard } from './ResourceDelegationsCard';
import { RecentWhaleDelegations } from './components/RecentWhaleDelegations';

/**
 * Card component imported from frontend context.
 * Provides consistent surface styling with elevation, borders, and shadows.
 */
interface ICard {
    (props: {
        children: React.ReactNode;
        className?: string;
        elevated?: boolean;
        padding?: 'sm' | 'md' | 'lg';
        tone?: 'default' | 'muted' | 'accent';
    }): JSX.Element;
}

interface ISummationPoint {
    timestamp: string;
    startBlock: number;
    endBlock: number;
    energyDelegated: number;
    energyReclaimed: number;
    bandwidthDelegated: number;
    bandwidthReclaimed: number;
    netEnergy: number;
    netBandwidth: number;
    transactionCount: number;
    totalTransactionsDelegated: number;
    totalTransactionsUndelegated: number;
    totalTransactionsNet: number;
}

/**
 * Summation response data type that may include null values for empty time buckets.
 *
 * The backend returns null for time buckets that have no data, which creates gaps
 * in the chart and prevents sparse data from appearing cramped on the X-axis.
 */
type SummationDataPoint = ISummationPoint | null;

type TimePeriod = '1d' | '7d' | '30d' | '6m';

/**
 * Chart color palette matching toggle labels.
 * Each color is consistent between the line chart and toggle label indicators.
 */
const CHART_COLORS = {
    energyDelegated: '#22c55e',
    energyReclaimed: '#ef4444',
    netEnergy: '#3b82f6',
    bandwidthDelegated: '#a855f7',
    bandwidthReclaimed: '#f97316',
    netBandwidth: '#06b6d4'
} as const;

/**
 * Resource Explorer Page Component.
 *
 * Displays resource delegation trends with configurable time periods and line toggles.
 * Shows energy and bandwidth delegation/reclaim flows over time using line charts
 * with data fetched from the resource-tracking plugin API.
 *
 * Features:
 * - Time period selector (1 day, 7 days, 30 days, 6 months)
 * - Line toggles for showing/hiding specific metrics
 * - Energy delegated, reclaimed, and net flows
 * - Bandwidth delegated, reclaimed, and net flows
 * - Responsive chart with container queries
 *
 * @param props - Component props
 * @param props.context - Frontend plugin context with API client, UI components, and charts
 */
export function ResourceTrackingPage({ context }: { context: IFrontendPluginContext }) {
    const { api, ui } = context;

    const [data, setData] = useState<SummationDataPoint[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [period, setPeriod] = useState<TimePeriod>('1d');

    // Line toggle state - Only Energy Delegated is checked by default
    const [showEnergyDelegated, setShowEnergyDelegated] = useState(true);
    const [showEnergyReclaimed, setShowEnergyReclaimed] = useState(false);
    const [showNetEnergy, setShowNetEnergy] = useState(false);
    const [showBandwidthDelegated, setShowBandwidthDelegated] = useState(false);
    const [showBandwidthReclaimed, setShowBandwidthReclaimed] = useState(false);
    const [showNetBandwidth, setShowNetBandwidth] = useState(false);

    /**
     * Calculate time range for the chart based on the selected period.
     *
     * Returns fixed min/max dates to prevent the chart from stretching sparse data
     * across the full width. Data points will appear at their actual timestamps within
     * the selected time range.
     *
     * Memoized to prevent creating new object references on every render, which would
     * break React.memo optimization on the child card component and cause unnecessary
     * re-renders (visual flashing).
     */
    const timeRange = useMemo(() => {
        const now = new Date();
        const periodMap: Record<TimePeriod, number> = {
            '1d': 1,
            '7d': 7,
            '30d': 30,
            '6m': 180
        };

        const days = periodMap[period];
        const minDate = new Date();
        minDate.setDate(minDate.getDate() - days);

        return { minDate, maxDate: now };
    }, [period]);

    /**
     * Load summation data from the API.
     *
     * Fetches aggregated resource delegation statistics for the selected time period.
     * Requests 288 data points with optional server-side sampling to optimize payload
     * size and chart rendering performance. This function is called on mount, when the
     * period changes, and when new summation data is created (triggered by WebSocket events).
     *
     * @param showLoading - Whether to show loading state (default true). Set to false for
     *                      background refreshes triggered by WebSocket to avoid UI flash.
     */
    async function loadData(showLoading: boolean = true) {
        if (showLoading) {
            setLoading(true);
        }
        setError(null);

        try {
            const response = await api.get('/plugins/resource-tracking/summations', {
                period,
                points: 288 // Request fixed 288-point sampling from backend
            });
            setData(response.data || []);
        } catch (err) {
            console.error('Failed to load resource tracking data:', err);
            setError('Failed to load resource tracking data');
        } finally {
            if (showLoading) {
                setLoading(false);
            }
        }
    }

    /**
     * Intelligently merge fresh data with existing data.
     *
     * When WebSocket events trigger background data refreshes, we want to update the chart
     * without flashing the UI. This function compares the existing dataset with fresh data
     * from the API and appends only the new points that don't already exist.
     *
     * The merge strategy:
     * 1. Identify the latest timestamp in the current dataset (skipping null values)
     * 2. Find all points in the fresh data that are newer than that timestamp
     * 3. Append those new points to the existing dataset
     *
     * This ensures smooth real-time updates while maintaining the sampled data's consistency.
     *
     * @param freshData - Newly fetched data from the API (288 sampled points, may include nulls)
     */
    function mergeData(freshData: SummationDataPoint[]) {
        setData(prevData => {
            if (prevData.length === 0) {
                // No existing data - use fresh data as-is
                return freshData;
            }

            // Find the latest non-null timestamp in current data
            const nonNullPrevData = prevData.filter(p => p !== null);
            if (nonNullPrevData.length === 0) {
                // All existing data is null - replace with fresh data
                return freshData;
            }

            const latestTimestamp = new Date(nonNullPrevData[nonNullPrevData.length - 1]!.timestamp).getTime();

            // Find new points in fresh data (points newer than our latest, including nulls)
            const newPoints = freshData.filter(point => {
                if (point === null) {
                    // Keep null values in the new portion (they represent empty time buckets)
                    return true;
                }
                const pointTimestamp = new Date(point.timestamp).getTime();
                return pointTimestamp > latestTimestamp;
            });

            if (newPoints.length === 0) {
                // No new data to append - keep existing data
                return prevData;
            }

            // Append new points to existing data
            console.log(`Merging ${newPoints.length} new points into chart (${prevData.length} existing)`);
            return [...prevData, ...newPoints];
        });
    }

    // Initial data load and reload when period changes
    useEffect(() => {
        // When period changes, we want to replace the data entirely (not merge)
        // So we call loadData with showLoading=true, which will reset the state
        setData([]); // Clear existing data first to prevent cramming during period switch
        void loadData();
    }, [api, period]);

    // WebSocket subscription for real-time updates
    useEffect(() => {
        const { websocket } = context;

        /**
         * Handle new summation creation events from the backend.
         *
         * When the summation job completes every 5 minutes, the backend emits this event
         * to all subscribed clients. Instead of directly appending the raw WebSocket payload,
         * we fetch fresh sampled data from the API and intelligently merge it with the
         * existing dataset to maintain consistency.
         *
         * This approach ensures:
         * 1. All data points are properly sampled (not mixing raw + sampled)
         * 2. Cache TTL is respected (may hit cache or fresh data depending on timing)
         * 3. UI doesn't flash (background fetch + merge, no loading state)
         * 4. Chart stays smooth and responsive
         */
        const handleSummationCreated = async (payload: any) => {
            console.log('New summation created:', payload);

            try {
                // Fetch fresh data in the background (no loading state)
                const response = await api.get('/plugins/resource-tracking/summations', {
                    period,
                    points: 288
                });

                // Intelligently merge fresh data with existing data
                if (response.data) {
                    mergeData(response.data);
                }
            } catch (err) {
                console.error('Failed to fetch fresh data after summation event:', err);
                // Silently fail - user still has existing data displayed
            }
        };

        /**
         * Handle subscription confirmation from the backend.
         *
         * This event fires after successfully subscribing to summation updates,
         * confirming that the client will receive real-time notifications.
         */
        const handleSubscribed = (data: any) => {
            console.log('Subscribed to resource tracking updates:', data);
        };

        /**
         * Handle subscription errors from the backend.
         *
         * If the subscription fails (e.g., invalid payload), this event provides
         * error details for debugging.
         */
        const handleSubscriptionError = (error: any) => {
            console.error('Failed to subscribe to resource tracking updates:', error);
        };

        /**
         * Resubscribe on reconnect to ensure continuous real-time updates.
         *
         * When the WebSocket connection drops and reconnects, we need to re-establish
         * our subscription to continue receiving summation events.
         */
        const handleReconnect = () => {
            console.log('WebSocket reconnected, resubscribing to summation updates');
            websocket.subscribe('summation-updates');
        };

        // Use helper method - automatically prefixes to 'resource-tracking:summation-created'
        websocket.on('summation-created', handleSummationCreated);

        // Use helper method for connection events
        websocket.onConnect(handleReconnect);

        console.log('📡 Listening for summation-created events');

        // Fire once immediately; the client buffers it until the connection is live
        websocket.subscribe('summation-updates');

        // Cleanup on unmount
        return () => {
            websocket.off('summation-created', handleSummationCreated);
            websocket.offConnect(handleReconnect);
        };
    }, [context.websocket]);

    /**
     * Determine whether any metrics that cross the zero line are currently displayed.
     *
     * Net metrics (net energy or net bandwidth) can have negative values naturally.
     * Reclaimed metrics are displayed as negative numbers to show them below the zero line.
     * When any of these metrics are shown, the Y-axis must include both positive and
     * negative ranges centered on zero to make the zero line visible.
     * Non-zero-crossing metrics (delegated only) should have a Y-axis minimum of zero.
     */
    const hasZeroCrossingMetrics = showNetEnergy || showNetBandwidth || showEnergyReclaimed || showBandwidthReclaimed;

    /**
     * Calculate Y-axis bounds based on displayed metrics.
     *
     * - When NO zero-crossing metrics are shown: Y-axis minimum is always 0 (non-negative values only)
     * - When zero-crossing metrics ARE shown: Y-axis is centered on 0 with symmetric positive/negative range
     *   to ensure the zero line appears in the middle of the chart
     *
     * Zero-crossing metrics include:
     * - Net energy and net bandwidth (naturally negative when reclaims exceed delegations)
     * - Energy and bandwidth reclaimed (displayed as negative to show below zero line)
     */
    let yAxisMin: number | undefined;
    let yAxisMax: number | undefined;

    if (data.length > 0) {
        if (!hasZeroCrossingMetrics) {
            // No zero-crossing metrics: bottom of chart should always be 0
            yAxisMin = 0;
            yAxisMax = undefined; // Let chart auto-scale the maximum
        } else {
            // Zero-crossing metrics present: center the chart on zero
            const allValues: number[] = [];

            // Filter out null values before collecting metric values
            const nonNullData = data.filter(p => p !== null);

            // Collect all visible metric values (reclaimed values will be negated when added to chart series)
            if (showEnergyDelegated) allValues.push(...nonNullData.map(p => p!.energyDelegated));
            if (showEnergyReclaimed) allValues.push(...nonNullData.map(p => -p!.energyReclaimed)); // Negated for display
            if (showNetEnergy) allValues.push(...nonNullData.map(p => p!.netEnergy));
            if (showBandwidthDelegated) allValues.push(...nonNullData.map(p => p!.bandwidthDelegated));
            if (showBandwidthReclaimed) allValues.push(...nonNullData.map(p => -p!.bandwidthReclaimed)); // Negated for display
            if (showNetBandwidth) allValues.push(...nonNullData.map(p => p!.netBandwidth));

            if (allValues.length > 0) {
                const dataMin = Math.min(...allValues);
                const dataMax = Math.max(...allValues);

                // Create symmetric range around zero
                const maxAbsValue = Math.max(Math.abs(dataMin), Math.abs(dataMax));

                // Add 10% padding to prevent data from touching the edges
                const paddedMax = maxAbsValue * 1.1;

                yAxisMin = -paddedMax;
                yAxisMax = paddedMax;
            }
        }
    }

    // Convert summation data to chart series format
    // Filter out null values (empty time buckets) before mapping to chart data
    const chartSeries = [];

    if (showEnergyDelegated && data.length > 0) {
        chartSeries.push({
            id: 'energy-delegated',
            label: 'Energy Delegated',
            data: data
                .filter(point => point !== null)
                .map(point => ({
                    date: point!.timestamp,
                    value: point!.energyDelegated, // Already in millions of TRX from API
                    metadata: {
                        transactions: point!.transactionCount,
                        blockRange: `${point!.startBlock.toLocaleString()} - ${point!.endBlock.toLocaleString()}`
                    }
                })),
            color: CHART_COLORS.energyDelegated,
            fill: true
        });
    }

    if (showEnergyReclaimed && data.length > 0) {
        chartSeries.push({
            id: 'energy-reclaimed',
            label: 'Energy Reclaimed',
            data: data
                .filter(point => point !== null)
                .map(point => ({
                    date: point!.timestamp,
                    value: -point!.energyReclaimed, // Negated to display below zero line
                    metadata: {
                        transactions: point!.transactionCount,
                        blockRange: `${point!.startBlock.toLocaleString()} - ${point!.endBlock.toLocaleString()}`
                    }
                })),
            color: CHART_COLORS.energyReclaimed,
            fill: true
        });
    }

    if (showNetEnergy && data.length > 0) {
        chartSeries.push({
            id: 'net-energy',
            label: 'Net Energy',
            data: data
                .filter(point => point !== null)
                .map(point => ({
                    date: point!.timestamp,
                    value: point!.netEnergy, // Already in millions of TRX from API
                    metadata: {
                        transactions: point!.transactionCount,
                        blockRange: `${point!.startBlock.toLocaleString()} - ${point!.endBlock.toLocaleString()}`
                    }
                })),
            color: CHART_COLORS.netEnergy,
            fill: true
        });
    }

    if (showBandwidthDelegated && data.length > 0) {
        chartSeries.push({
            id: 'bandwidth-delegated',
            label: 'Bandwidth Delegated',
            data: data
                .filter(point => point !== null)
                .map(point => ({
                    date: point!.timestamp,
                    value: point!.bandwidthDelegated, // Already in millions of TRX from API
                    metadata: {
                        transactions: point!.transactionCount,
                        blockRange: `${point!.startBlock.toLocaleString()} - ${point!.endBlock.toLocaleString()}`
                    }
                })),
            color: CHART_COLORS.bandwidthDelegated,
            fill: true
        });
    }

    if (showBandwidthReclaimed && data.length > 0) {
        chartSeries.push({
            id: 'bandwidth-reclaimed',
            label: 'Bandwidth Reclaimed',
            data: data
                .filter(point => point !== null)
                .map(point => ({
                    date: point!.timestamp,
                    value: -point!.bandwidthReclaimed, // Negated to display below zero line
                    metadata: {
                        transactions: point!.transactionCount,
                        blockRange: `${point!.startBlock.toLocaleString()} - ${point!.endBlock.toLocaleString()}`
                    }
                })),
            color: CHART_COLORS.bandwidthReclaimed,
            fill: true
        });
    }

    if (showNetBandwidth && data.length > 0) {
        chartSeries.push({
            id: 'net-bandwidth',
            label: 'Net Bandwidth',
            data: data
                .filter(point => point !== null)
                .map(point => ({
                    date: point!.timestamp,
                    value: point!.netBandwidth, // Already in millions of TRX from API
                    metadata: {
                        transactions: point!.transactionCount,
                        blockRange: `${point!.startBlock.toLocaleString()} - ${point!.endBlock.toLocaleString()}`
                    }
                })),
            color: CHART_COLORS.netBandwidth,
            fill: true
        });
    }

    return (
        <main className={styles.page}>
            <header className={styles.header}>
                <h1 className={styles.title}>
                    <Activity size={28} style={{ display: 'inline-block', marginRight: '0.5rem', verticalAlign: 'middle' }} />
                    TRON Resource Explorer
                </h1>
                <div className={styles.subtitle}>
                    <p className={styles.subtitleShort}>
                        Visualize TRON network energy and bandwidth delegation patterns with real-time trend analysis.
                    </p>
                    <p className={styles.subtitleFull}>
                        Monitor TRON energy and bandwidth delegation activity across the network. This dashboard tracks how users stake TRX to generate resources, delegate them to other addresses, and reclaim them over time. View network-wide patterns showing resource flows, net changes, and transaction volume trends. All values displayed in TRX equivalence based on staking amounts.
                    </p>
                </div>
            </header>

            <div className={styles.content_layout}>
                <div className={styles.content_main}>
                    <ResourceDelegationsCard
                        context={context}
                        period={period}
                        setPeriod={setPeriod}
                        chartSeries={chartSeries}
                        timeRange={timeRange}
                        yAxisMin={yAxisMin}
                        yAxisMax={yAxisMax}
                        showEnergyDelegated={showEnergyDelegated}
                        setShowEnergyDelegated={setShowEnergyDelegated}
                        showEnergyReclaimed={showEnergyReclaimed}
                        setShowEnergyReclaimed={setShowEnergyReclaimed}
                        showNetEnergy={showNetEnergy}
                        setShowNetEnergy={setShowNetEnergy}
                        showBandwidthDelegated={showBandwidthDelegated}
                        setShowBandwidthDelegated={setShowBandwidthDelegated}
                        showBandwidthReclaimed={showBandwidthReclaimed}
                        setShowBandwidthReclaimed={setShowBandwidthReclaimed}
                        showNetBandwidth={showNetBandwidth}
                        setShowNetBandwidth={setShowNetBandwidth}
                        loading={loading}
                        error={error}
                        onRetry={() => void loadData()}
                    />
                </div>
                <div className={styles.content_sidebar}>
                    <RecentWhaleDelegations
                        context={context}
                        limit={10}
                        whaleDetectionEnabled={true}
                        defaultCompact={true}
                    />
                </div>
            </div>
        </main>
    );
}
