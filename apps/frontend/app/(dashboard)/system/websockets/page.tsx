'use client';

import { useEffect, useState } from 'react';
import type { IPluginWebSocketStats, IAggregatePluginWebSocketStats } from '@tronrelic/types';

/**
 * Plugin WebSocket Monitoring Page.
 *
 * Displays real-time statistics for all plugin WebSocket subscriptions, rooms, and event
 * emissions. Provides system-wide aggregates and per-plugin detailed breakdowns for debugging
 * and capacity planning. Requires admin authentication.
 */
export default function WebSocketMonitoringPage() {
    const [aggregate, setAggregate] = useState<IAggregatePluginWebSocketStats | null>(null);
    const [pluginStats, setPluginStats] = useState<IPluginWebSocketStats[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    /**
     * Fetch WebSocket statistics from the backend API.
     *
     * Retrieves both aggregate system-wide stats and per-plugin detailed metrics.
     * Automatically refreshes every 5 seconds to show real-time subscription and
     * emission activity.
     */
    const fetchStats = async () => {
        try {
            const token = localStorage.getItem('adminToken');
            if (!token) {
                setError('Admin token not found. Please log in.');
                setLoading(false);
                return;
            }

            const [aggregateRes, statsRes] = await Promise.all([
                fetch('/api/system/websockets/aggregate', {
                    headers: { 'Authorization': `Bearer ${token}` }
                }),
                fetch('/api/system/websockets/stats', {
                    headers: { 'Authorization': `Bearer ${token}` }
                })
            ]);

            if (!aggregateRes.ok || !statsRes.ok) {
                throw new Error('Failed to fetch WebSocket statistics');
            }

            const aggregateData = await aggregateRes.json();
            const statsData = await statsRes.json();

            setAggregate(aggregateData.aggregate);
            setPluginStats(statsData.stats);
            setError(null);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            setError(message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void fetchStats();

        // Refresh stats every 5 seconds
        const interval = setInterval(() => {
            void fetchStats();
        }, 5000);

        return () => clearInterval(interval);
    }, []);

    if (loading) {
        return (
            <div className="page">
                <div className="page-header">
                    <h1 className="page-title">Plugin WebSocket Monitoring</h1>
                </div>
                <p>Loading WebSocket statistics...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="page">
                <div className="page-header">
                    <h1 className="page-title">Plugin WebSocket Monitoring</h1>
                </div>
                <div style={{ padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', borderRadius: '0.5rem' }}>
                    <p style={{ color: '#ef4444', margin: 0 }}>Error: {error}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="page">
            <div className="page-header">
                <h1 className="page-title">Plugin WebSocket Monitoring</h1>
                <p style={{ color: 'var(--color-text-subtle)', marginTop: '0.5rem' }}>
                    Real-time monitoring of plugin WebSocket subscriptions and events
                </p>
            </div>

            {/* Aggregate Statistics */}
            {aggregate && (
                <div style={{ marginBottom: '2rem' }}>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>System Overview</h2>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                        <StatCard
                            label="Total Plugins"
                            value={aggregate.totalPlugins}
                            subtitle="with WebSocket handlers"
                        />
                        <StatCard
                            label="Active Subscriptions"
                            value={aggregate.totalSubscriptions}
                            subtitle={`across ${aggregate.totalRooms} rooms`}
                        />
                        <StatCard
                            label="Events Emitted"
                            value={aggregate.totalEventsEmitted.toLocaleString()}
                            subtitle="since startup"
                        />
                        <StatCard
                            label="Subscription Errors"
                            value={aggregate.totalSubscriptionErrors}
                            subtitle="total failures"
                            alert={aggregate.totalSubscriptionErrors > 0}
                        />
                    </div>

                    {aggregate.mostActivePlugin && (
                        <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(124, 155, 255, 0.1)', borderRadius: '0.5rem' }}>
                            <p style={{ margin: 0, fontSize: '0.875rem' }}>
                                <strong>Most Active Plugin:</strong> {aggregate.mostActivePlugin.pluginId} ({aggregate.mostActivePlugin.subscriptionCount} subscriptions)
                            </p>
                        </div>
                    )}
                </div>
            )}

            {/* Per-Plugin Statistics */}
            <div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>Plugin Details</h2>
                {pluginStats.length === 0 ? (
                    <p style={{ color: 'var(--color-text-subtle)' }}>No plugins with WebSocket capabilities found.</p>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {pluginStats.map(stats => (
                            <PluginStatsCard key={stats.pluginId} stats={stats} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

/**
 * Stat card component for displaying a single metric.
 *
 * Shows a metric value with a label and optional subtitle. Supports alert styling
 * for highlighting errors or warnings.
 *
 * @param props - Component props
 * @param props.label - The metric label
 * @param props.value - The metric value (number or string)
 * @param props.subtitle - Optional subtitle text
 * @param props.alert - Whether to use alert (error) styling
 */
function StatCard({ label, value, subtitle, alert }: {
    label: string;
    value: number | string;
    subtitle?: string;
    alert?: boolean;
}) {
    return (
        <div style={{
            padding: '1rem',
            background: alert ? 'rgba(239, 68, 68, 0.1)' : 'rgba(9, 15, 28, 0.6)',
            border: `1px solid ${alert ? '#ef4444' : 'var(--color-border)'}`,
            borderRadius: '0.5rem'
        }}>
            <div style={{ fontSize: '0.875rem', color: 'var(--color-text-subtle)', marginBottom: '0.5rem' }}>
                {label}
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: alert ? '#ef4444' : 'inherit' }}>
                {value}
            </div>
            {subtitle && (
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', marginTop: '0.25rem' }}>
                    {subtitle}
                </div>
            )}
        </div>
    );
}

/**
 * Plugin statistics card component.
 *
 * Displays detailed WebSocket metrics for a single plugin including subscription handlers,
 * active rooms, event emission rates, and error counts. Expandable to show per-room breakdowns.
 *
 * @param props - Component props
 * @param props.stats - The plugin WebSocket statistics
 */
function PluginStatsCard({ stats }: { stats: IPluginWebSocketStats }) {
    const [expanded, setExpanded] = useState(false);

    return (
        <div style={{
            padding: '1.5rem',
            background: 'rgba(9, 15, 28, 0.6)',
            border: '1px solid var(--color-border)',
            borderRadius: '0.5rem'
        }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <div>
                    <h3 style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0 }}>{stats.pluginTitle}</h3>
                    <p style={{ fontSize: '0.875rem', color: 'var(--color-text-subtle)', margin: '0.25rem 0 0' }}>
                        {stats.pluginId}
                    </p>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    {stats.hasSubscriptionHandler && (
                        <span style={{
                            padding: '0.25rem 0.75rem',
                            background: 'rgba(34, 197, 94, 0.2)',
                            border: '1px solid #22c55e',
                            borderRadius: '9999px',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            color: '#22c55e'
                        }}>
                            ACTIVE
                        </span>
                    )}
                </div>
            </div>

            {/* Metrics Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
                <MetricItem label="Active Rooms" value={stats.activeRooms} />
                <MetricItem label="Total Subscriptions" value={stats.totalSubscriptions} />
                <MetricItem label="Events Emitted" value={stats.totalEventsEmitted.toLocaleString()} />
                <MetricItem label="Events/min" value={stats.eventsPerMinute} />
                <MetricItem label="Errors" value={stats.totalSubscriptionErrors} alert={stats.totalSubscriptionErrors > 0} />
            </div>

            {/* Room Breakdown */}
            {stats.roomStats.length > 0 && (
                <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--color-border)' }}>
                    <button
                        onClick={() => setExpanded(!expanded)}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--color-primary)',
                            cursor: 'pointer',
                            fontSize: '0.875rem',
                            fontWeight: 600,
                            padding: 0,
                            marginBottom: expanded ? '0.75rem' : 0
                        }}
                    >
                        {expanded ? '▼' : '▶'} Room Details ({stats.roomStats.length} rooms)
                    </button>

                    {expanded && (
                        <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {stats.roomStats.map(room => (
                                <div
                                    key={room.fullRoomName}
                                    style={{
                                        padding: '0.75rem',
                                        background: 'rgba(0, 0, 0, 0.3)',
                                        borderRadius: '0.375rem',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center'
                                    }}
                                >
                                    <div>
                                        <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>
                                            {room.roomName}
                                        </div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', marginTop: '0.25rem' }}>
                                            {room.fullRoomName}
                                        </div>
                                    </div>
                                    <div style={{
                                        fontSize: '0.875rem',
                                        fontWeight: 600,
                                        color: room.memberCount > 0 ? '#22c55e' : 'var(--color-text-subtle)'
                                    }}>
                                        {room.memberCount} {room.memberCount === 1 ? 'subscriber' : 'subscribers'}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Last Activity */}
            {stats.lastEventEmittedAt && (
                <div style={{ marginTop: '1rem', fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>
                    Last event: {new Date(stats.lastEventEmittedAt).toLocaleString()}
                </div>
            )}
        </div>
    );
}

/**
 * Metric item component for inline metrics display.
 *
 * Shows a small metric with label and value, used within plugin stat cards.
 *
 * @param props - Component props
 * @param props.label - The metric label
 * @param props.value - The metric value
 * @param props.alert - Whether to highlight as an alert/error
 */
function MetricItem({ label, value, alert }: { label: string; value: number | string; alert?: boolean }) {
    return (
        <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', marginBottom: '0.25rem' }}>
                {label}
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 600, color: alert ? '#ef4444' : 'inherit' }}>
                {value}
            </div>
        </div>
    );
}
