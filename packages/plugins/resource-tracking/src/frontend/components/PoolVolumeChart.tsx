'use client';

import { useEffect, useState } from 'react';
import type { IFrontendPluginContext } from '@tronrelic/types';
import { PieChart, RefreshCw, ExternalLink } from 'lucide-react';
import styles from './PoolVolumeChart.module.css';

/**
 * Pool data from the API response.
 */
interface IPoolData {
    poolAddress: string | null;
    poolName: string | null;
    totalAmountTrx: number;
    delegationCount: number;
    delegatorCount: number;
    recipientCount: number;
}

/**
 * Props for PoolVolumeChart component.
 */
interface PoolVolumeChartProps {
    context: IFrontendPluginContext;
    hours?: number;
    onPoolClick?: (address: string) => void;
}

/**
 * Color palette for the doughnut chart segments.
 */
const CHART_COLORS = [
    '#3b82f6', // blue
    '#22c55e', // green
    '#f59e0b', // amber
    '#ef4444', // red
    '#8b5cf6', // violet
    '#06b6d4', // cyan
    '#ec4899', // pink
    '#f97316', // orange
    '#14b8a6', // teal
    '#6366f1', // indigo
];

/**
 * Pool Volume Chart Component.
 *
 * Dashboard widget displaying a doughnut chart of energy delegation volume by pool.
 * This component uses client-side data loading because the time period (hours) is
 * a configurable parameter that may change at runtime.
 *
 * The chart shows the top 10 pools by delegation volume with:
 * - Interactive segments with hover highlighting
 * - Clickable legend items for navigation to pool detail pages
 * - Real-time updates via WebSocket subscription
 *
 * @param props - Component props
 * @param props.context - Frontend plugin context with API and UI
 * @param props.hours - Time period in hours (default: 24)
 * @param props.onPoolClick - Callback when a pool is clicked
 */
export function PoolVolumeChart({ context, hours = 24, onPoolClick }: PoolVolumeChartProps) {
    const { api, ui } = context;
    const Card = ui.Card;

    const [pools, setPools] = useState<IPoolData[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

    /**
     * Load pool data from the API.
     */
    async function loadPools() {
        setLoading(true);
        setError(null);

        try {
            const response = await api.get('/plugins/resource-tracking/pools', { hours });
            setPools(response.pools || []);
        } catch (err) {
            console.error('Failed to load pool data:', err);
            setError('Failed to load pool data');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        void loadPools();
    }, [api, hours]);

    // Listen for aggregated pool data (subscription managed by parent PoolsPage).
    // Backend pushes full dataset once per block - no API call needed.
    useEffect(() => {
        const { websocket } = context;

        /**
         * Handle aggregated pool data pushed from backend.
         * Receives complete dataset - no API call needed.
         */
        const handlePoolsUpdated = (data: {
            pools: IPoolData[];
            hours: number;
            timestamp: number;
        }) => {
            setPools(data.pools || []);
            setLoading(false);
        };

        // Note: Room subscription is managed by parent PoolsPage to avoid
        // race conditions where multiple components subscribe/unsubscribe
        // to the same room independently
        websocket.on('pools:updated', handlePoolsUpdated);

        return () => {
            websocket.off('pools:updated', handlePoolsUpdated);
        };
    }, [context.websocket]);

    // Calculate total volume for percentages
    const totalVolume = pools.reduce((sum, p) => sum + p.totalAmountTrx, 0);

    // Calculate chart segments for top 10 pools
    const segments = pools.slice(0, 10).map((pool, index) => {
        const percentage = totalVolume > 0 ? (pool.totalAmountTrx / totalVolume) * 100 : 0;
        return {
            pool,
            color: CHART_COLORS[index % CHART_COLORS.length],
            percentage,
            startAngle: 0,
            endAngle: 0
        };
    });

    // Calculate cumulative angles for each segment
    let currentAngle = -90; // Start from top
    segments.forEach(segment => {
        segment.startAngle = currentAngle;
        segment.endAngle = currentAngle + (segment.percentage / 100) * 360;
        currentAngle = segment.endAngle;
    });

    /**
     * Convert polar to Cartesian coordinates for SVG path.
     */
    function polarToCartesian(cx: number, cy: number, radius: number, angleInDegrees: number) {
        const angleInRadians = (angleInDegrees * Math.PI) / 180;
        return {
            x: cx + radius * Math.cos(angleInRadians),
            y: cy + radius * Math.sin(angleInRadians)
        };
    }

    /**
     * Generate SVG arc path for a doughnut segment.
     */
    function describeArc(cx: number, cy: number, outerRadius: number, innerRadius: number, startAngle: number, endAngle: number) {
        const start = polarToCartesian(cx, cy, outerRadius, endAngle);
        const end = polarToCartesian(cx, cy, outerRadius, startAngle);
        const innerStart = polarToCartesian(cx, cy, innerRadius, endAngle);
        const innerEnd = polarToCartesian(cx, cy, innerRadius, startAngle);

        const largeArcFlag = endAngle - startAngle <= 180 ? 0 : 1;

        return [
            'M', start.x, start.y,
            'A', outerRadius, outerRadius, 0, largeArcFlag, 0, end.x, end.y,
            'L', innerEnd.x, innerEnd.y,
            'A', innerRadius, innerRadius, 0, largeArcFlag, 1, innerStart.x, innerStart.y,
            'Z'
        ].join(' ');
    }

    /**
     * Format pool name for display, falling back to truncated address.
     */
    function formatPoolName(pool: IPoolData): string {
        if (pool.poolName) return pool.poolName;
        if (pool.poolAddress) return `${pool.poolAddress.slice(0, 6)}...${pool.poolAddress.slice(-4)}`;
        return 'Unknown Pool';
    }

    /**
     * Format TRX amount with K/M suffixes.
     */
    function formatTrx(amount: number): string {
        if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
        if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K`;
        return amount.toFixed(0);
    }

    if (loading) {
        return (
            <Card className={styles.card}>
                <div className={styles.loading}>
                    <RefreshCw className={styles.spinner} size={24} />
                    <span>Loading pool data...</span>
                </div>
            </Card>
        );
    }

    if (error) {
        return (
            <Card className={styles.card}>
                <div className={styles.error}>
                    <span>{error}</span>
                    <button onClick={() => void loadPools()} className={styles.retry_button}>
                        Retry
                    </button>
                </div>
            </Card>
        );
    }

    if (pools.length === 0) {
        return (
            <Card className={styles.card}>
                <div className={styles.empty}>
                    <PieChart size={48} className={styles.empty_icon} />
                    <p>No pool delegation data available yet.</p>
                    <p className={styles.empty_hint}>Pool data accumulates as delegation transactions with Permission_id ≥ 3 are processed.</p>
                </div>
            </Card>
        );
    }

    return (
        <Card className={styles.card}>
            <div className={styles.header}>
                <h3 className={styles.title}>
                    <PieChart size={20} />
                    Pool Delegation Volume
                </h3>
                <span className={styles.period}>{hours}h</span>
            </div>

            <div className={styles.chart_container}>
                {/* SVG Doughnut Chart */}
                <svg viewBox="0 0 200 200" className={styles.chart}>
                    {segments.map((segment, index) => (
                        <path
                            key={index}
                            d={describeArc(100, 100, 80, 50, segment.startAngle, segment.endAngle)}
                            fill={segment.color}
                            className={styles.segment}
                            opacity={hoveredIndex === null || hoveredIndex === index ? 1 : 0.4}
                            onMouseEnter={() => setHoveredIndex(index)}
                            onMouseLeave={() => setHoveredIndex(null)}
                            onClick={() => segment.pool.poolAddress && onPoolClick?.(segment.pool.poolAddress)}
                            style={{ cursor: segment.pool.poolAddress ? 'pointer' : 'default' }}
                        />
                    ))}
                    {/* Center text */}
                    <text x="100" y="95" textAnchor="middle" className={styles.center_label}>
                        {formatTrx(totalVolume)}
                    </text>
                    <text x="100" y="112" textAnchor="middle" className={styles.center_sub_label}>
                        TRX Total
                    </text>
                </svg>

                {/* Legend */}
                <div className={styles.legend}>
                    {segments.map((segment, index) => (
                        <div
                            key={index}
                            className={styles.legend_item}
                            onMouseEnter={() => setHoveredIndex(index)}
                            onMouseLeave={() => setHoveredIndex(null)}
                            onClick={() => segment.pool.poolAddress && onPoolClick?.(segment.pool.poolAddress)}
                            style={{ opacity: hoveredIndex === null || hoveredIndex === index ? 1 : 0.5 }}
                        >
                            <span
                                className={styles.legend_color}
                                style={{ backgroundColor: segment.color }}
                            />
                            <span className={styles.legend_name}>
                                {formatPoolName(segment.pool)}
                            </span>
                            <span className={styles.legend_value}>
                                {segment.percentage.toFixed(1)}%
                            </span>
                            {segment.pool.poolAddress && (
                                <ExternalLink size={12} className={styles.legend_link} />
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* Summary stats */}
            <div className={styles.stats}>
                <div className={styles.stat}>
                    <span className={styles.stat_value}>{pools.length}</span>
                    <span className={styles.stat_label}>Active Pools</span>
                </div>
                <div className={styles.stat}>
                    <span className={styles.stat_value}>
                        {pools.reduce((sum, p) => sum + p.delegationCount, 0).toLocaleString()}
                    </span>
                    <span className={styles.stat_label}>Delegations</span>
                </div>
            </div>
        </Card>
    );
}
