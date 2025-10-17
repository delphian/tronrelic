'use client';

import { useEffect, useState } from 'react';
import type { IFrontendPluginContext } from '@tronrelic/types';
import styles from './ResourceTrackingPage.module.css';

interface ISummationPoint {
    timestamp: string;
    energyDelegated: number;
    energyReclaimed: number;
    bandwidthDelegated: number;
    bandwidthReclaimed: number;
    netEnergy: number;
    netBandwidth: number;
}

type TimePeriod = '1d' | '7d' | '30d' | '6m';

/**
 * Resource Tracking Page Component.
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
    const { ui, api, charts } = context;

    const [data, setData] = useState<ISummationPoint[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [period, setPeriod] = useState<TimePeriod>('7d');

    // Line toggle state
    const [showEnergyDelegated, setShowEnergyDelegated] = useState(true);
    const [showEnergyReclaimed, setShowEnergyReclaimed] = useState(true);
    const [showNetEnergy, setShowNetEnergy] = useState(true);
    const [showBandwidthDelegated, setShowBandwidthDelegated] = useState(false);
    const [showBandwidthReclaimed, setShowBandwidthReclaimed] = useState(false);
    const [showNetBandwidth, setShowNetBandwidth] = useState(false);

    /**
     * Load summation data from the API.
     *
     * Fetches aggregated resource delegation statistics for the selected time period.
     * This function is called on mount, when the period changes, and when new summation
     * data is created (triggered by WebSocket events).
     */
    async function loadData() {
        setLoading(true);
        setError(null);

        try {
            const response = await api.get('/plugins/resource-tracking/summations', { period });
            setData(response.data || []);
        } catch (err) {
            console.error('Failed to load resource tracking data:', err);
            setError('Failed to load resource tracking data');
        } finally {
            setLoading(false);
        }
    }

    // Initial data load and reload when period changes
    useEffect(() => {
        void loadData();
    }, [api, period]);

    // WebSocket subscription for real-time updates
    useEffect(() => {
        const { websocket } = context;

        /**
         * Handle new summation creation events from the backend.
         *
         * When the summation job completes every 10 minutes, the backend emits this event
         * to all subscribed clients. We refetch the data to update the chart with the latest
         * aggregated statistics.
         */
        const handleSummationCreated = (payload: any) => {
            console.log('New summation created:', payload);
            // Refetch data to update chart with latest summation
            void loadData();
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
            websocket.subscribe('summation-updates', {});
        };

        // Subscribe to summation updates room
        websocket.subscribe('summation-updates', {});

        // Register event listeners
        websocket.on('summation-created', handleSummationCreated);
        websocket.on('subscribed', handleSubscribed);
        websocket.on('subscription-error', handleSubscriptionError);
        websocket.onConnect(handleReconnect);

        // Cleanup on unmount
        return () => {
            websocket.unsubscribe('summation-updates', {});
            websocket.off('summation-created', handleSummationCreated);
            websocket.off('subscribed', handleSubscribed);
            websocket.off('subscription-error', handleSubscriptionError);
            websocket.offConnect(handleReconnect);
        };
    }, [context.websocket]);

    // Convert summation data to chart series format
    const chartSeries = [];

    if (showEnergyDelegated && data.length > 0) {
        chartSeries.push({
            name: 'Energy Delegated',
            data: data.map(point => ({
                date: point.timestamp,
                value: point.energyDelegated / 1_000_000 // Convert SUN to TRX
            })),
            color: '#22c55e' // Green
        });
    }

    if (showEnergyReclaimed && data.length > 0) {
        chartSeries.push({
            name: 'Energy Reclaimed',
            data: data.map(point => ({
                date: point.timestamp,
                value: point.energyReclaimed / 1_000_000
            })),
            color: '#ef4444' // Red
        });
    }

    if (showNetEnergy && data.length > 0) {
        chartSeries.push({
            name: 'Net Energy',
            data: data.map(point => ({
                date: point.timestamp,
                value: point.netEnergy / 1_000_000
            })),
            color: '#3b82f6' // Blue
        });
    }

    if (showBandwidthDelegated && data.length > 0) {
        chartSeries.push({
            name: 'Bandwidth Delegated',
            data: data.map(point => ({
                date: point.timestamp,
                value: point.bandwidthDelegated / 1_000_000
            })),
            color: '#a855f7' // Purple
        });
    }

    if (showBandwidthReclaimed && data.length > 0) {
        chartSeries.push({
            name: 'Bandwidth Reclaimed',
            data: data.map(point => ({
                date: point.timestamp,
                value: point.bandwidthReclaimed / 1_000_000
            })),
            color: '#f97316' // Orange
        });
    }

    if (showNetBandwidth && data.length > 0) {
        chartSeries.push({
            name: 'Net Bandwidth',
            data: data.map(point => ({
                date: point.timestamp,
                value: point.netBandwidth / 1_000_000
            })),
            color: '#06b6d4' // Cyan
        });
    }

    if (loading) {
        return (
            <main className={styles.page}>
                <header className={styles.header}>
                    <h1 className={styles.title}>Resource Tracking</h1>
                    <p className={styles.subtitle}>Loading delegation data...</p>
                </header>
            </main>
        );
    }

    if (error) {
        return (
            <main className={styles.page}>
                <header className={styles.header}>
                    <h1 className={styles.title}>Resource Tracking</h1>
                    <p className={styles.subtitle}>{error}</p>
                </header>
            </main>
        );
    }

    return (
        <main className={styles.page}>
            <header className={styles.header}>
                <h1 className={styles.title}>Resource Tracking</h1>
                <p className={styles.subtitle}>
                    Monitor TRON resource delegation and reclaim patterns over time
                </p>
            </header>

            <div className={`surface ${styles.container}`}>
                {/* Time Period Selector */}
                <div className={styles.controls}>
                    <div className={styles.periodSelector}>
                        <span className={styles.label}>Time Period:</span>
                        <div className={styles.buttonGroup}>
                            <button
                                className={`btn btn--sm ${period === '1d' ? 'btn--primary' : ''}`}
                                onClick={() => setPeriod('1d')}
                            >
                                1 Day
                            </button>
                            <button
                                className={`btn btn--sm ${period === '7d' ? 'btn--primary' : ''}`}
                                onClick={() => setPeriod('7d')}
                            >
                                7 Days
                            </button>
                            <button
                                className={`btn btn--sm ${period === '30d' ? 'btn--primary' : ''}`}
                                onClick={() => setPeriod('30d')}
                            >
                                30 Days
                            </button>
                            <button
                                className={`btn btn--sm ${period === '6m' ? 'btn--primary' : ''}`}
                                onClick={() => setPeriod('6m')}
                            >
                                6 Months
                            </button>
                        </div>
                    </div>

                    {/* Line Toggles */}
                    <div className={styles.toggles}>
                        <span className={styles.label}>Show Lines:</span>
                        <div className={styles.toggleGroup}>
                            <label className={styles.toggle}>
                                <input
                                    type="checkbox"
                                    checked={showEnergyDelegated}
                                    onChange={(e) => setShowEnergyDelegated(e.target.checked)}
                                />
                                <span className={styles.toggleLabel} style={{ color: '#22c55e' }}>
                                    Energy Delegated
                                </span>
                            </label>
                            <label className={styles.toggle}>
                                <input
                                    type="checkbox"
                                    checked={showEnergyReclaimed}
                                    onChange={(e) => setShowEnergyReclaimed(e.target.checked)}
                                />
                                <span className={styles.toggleLabel} style={{ color: '#ef4444' }}>
                                    Energy Reclaimed
                                </span>
                            </label>
                            <label className={styles.toggle}>
                                <input
                                    type="checkbox"
                                    checked={showNetEnergy}
                                    onChange={(e) => setShowNetEnergy(e.target.checked)}
                                />
                                <span className={styles.toggleLabel} style={{ color: '#3b82f6' }}>
                                    Net Energy
                                </span>
                            </label>
                            <label className={styles.toggle}>
                                <input
                                    type="checkbox"
                                    checked={showBandwidthDelegated}
                                    onChange={(e) => setShowBandwidthDelegated(e.target.checked)}
                                />
                                <span className={styles.toggleLabel} style={{ color: '#a855f7' }}>
                                    Bandwidth Delegated
                                </span>
                            </label>
                            <label className={styles.toggle}>
                                <input
                                    type="checkbox"
                                    checked={showBandwidthReclaimed}
                                    onChange={(e) => setShowBandwidthReclaimed(e.target.checked)}
                                />
                                <span className={styles.toggleLabel} style={{ color: '#f97316' }}>
                                    Bandwidth Reclaimed
                                </span>
                            </label>
                            <label className={styles.toggle}>
                                <input
                                    type="checkbox"
                                    checked={showNetBandwidth}
                                    onChange={(e) => setShowNetBandwidth(e.target.checked)}
                                />
                                <span className={styles.toggleLabel} style={{ color: '#06b6d4' }}>
                                    Net Bandwidth
                                </span>
                            </label>
                        </div>
                    </div>
                </div>

                {/* Chart */}
                <div className={styles.chartContainer}>
                    {chartSeries.length > 0 ? (
                        <charts.LineChart
                            series={chartSeries}
                            height={400}
                            yAxisLabel="TRX"
                        />
                    ) : (
                        <div className={styles.noData}>
                            <p>No data available or all lines are hidden</p>
                            <p className={styles.noDataHint}>
                                Select at least one line to display the chart
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </main>
    );
}
