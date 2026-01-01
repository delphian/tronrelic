'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { ChevronDown } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '../../../../store/hooks';
import { setInitialBlock } from '../../slice';
import { Card } from '../../../../components/ui/Card';
import { Badge } from '../../../../components/ui/Badge';
import { cn } from '../../../../lib/cn';
import { useRealtimeStatus } from '../../../realtime/hooks/useRealtimeStatus';
import { useTransactionTimeseries } from '../../hooks/useTransactionTimeseries';
import type { BlockSummary } from '../../slice';
import styles from './CurrentBlock.module.scss';

/**
 * Dynamically import LineChart to reduce initial bundle size.
 * The chart is hidden by default (showGraph=false) so deferring its load
 * removes the charting library from the critical rendering path.
 */
const LineChart = dynamic(
    () => import('../../../charts/components/LineChart/LineChart').then(mod => mod.LineChart),
    { ssr: false }
);

/**
 * Props for the CurrentBlock component.
 */
interface CurrentBlockProps {
    /**
     * Initial block data passed from server component for SSR rendering.
     * When provided, the component renders immediately without a loading flash.
     * After hydration, live WebSocket updates take over.
     */
    initialBlock?: BlockSummary | null;
}

/**
 * CurrentBlock - Compact display of the currently processed blockchain block
 *
 * Follows the SSR + Live Updates pattern: renders fully on the server with real data
 * (no loading flash), then hydrates for WebSocket-driven live updates.
 *
 * **Compact Design:**
 * The component displays essential information (block number, transaction count,
 * live status) in a single compact row. Detailed statistics and graph are hidden
 * by default and revealed by clicking the expand toggle.
 *
 * **Mobile Responsiveness:**
 * Uses container queries to adapt layout for mobile devices, progressively
 * condensing the display at smaller widths while maintaining readability.
 *
 * @param props - Component properties including optional SSR initial block data
 * @returns A compact card displaying current block information
 */
export function CurrentBlock({ initialBlock }: CurrentBlockProps) {
    const dispatch = useAppDispatch();
    const reduxBlock = useAppSelector(state => state.blockchain.latestBlock);
    const status = useAppSelector(state => state.blockchain.status);
    const lastUpdated = useAppSelector(state => state.blockchain.lastUpdated);
    const blockHistory = useAppSelector(state => state.blockchain.history);
    const realtime = useRealtimeStatus();
    const [isMounted, setIsMounted] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const [showGraph, setShowGraph] = useState(false);
    const [selectedPeriod, setSelectedPeriod] = useState<'live' | 1 | 7 | 30>('live');
    const [hasReceivedLiveData, setHasReceivedLiveData] = useState(false);

    // SSR + Live Updates: Use Redux data when available, fall back to SSR initial data
    const latestBlock = reduxBlock || initialBlock;

    // Sync SSR initial block to Redux on mount (enables history tracking)
    useEffect(() => {
        if (initialBlock && !reduxBlock) {
            dispatch(setInitialBlock(initialBlock));
        }
    }, [initialBlock, reduxBlock, dispatch]);

    // Derive effective status: if we have data from SSR, we're ready
    const effectiveStatus = latestBlock ? 'ready' : status;

    // Only fetch from API when not in live mode
    const { data: timeseriesData, loading: timeseriesLoading, error: timeseriesError } = useTransactionTimeseries(
        selectedPeriod === 'live' ? 1 : selectedPeriod
    );

    // Use live Redux data when in live mode
    const liveTimeseriesData = blockHistory.map(block => ({
        date: block.timestamp,
        transactions: block.transactionCount
    }));

    // Determine which data source to use
    const isLiveMode = selectedPeriod === 'live';
    const chartData = isLiveMode ? liveTimeseriesData : timeseriesData;
    const chartLoading = isLiveMode ? false : timeseriesLoading;
    const chartError = isLiveMode ? null : timeseriesError;

    // Get primary color from CSS variables for chart
    const [primaryColor, setPrimaryColor] = useState('#7C9BFF');

    useEffect(() => {
        setIsMounted(true);
        if (typeof window !== 'undefined') {
            const color = getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim();
            if (color) {
                setPrimaryColor(color);
            }
        }
    }, []);

    // Track when we receive live WebSocket updates
    useEffect(() => {
        if (realtime.label === 'Live' && lastUpdated) {
            setHasReceivedLiveData(true);
        }
    }, [realtime.label, lastUpdated]);

    /**
     * Wrapper class for hydration transition.
     */
    const wrapperClass = initialBlock
        ? cn(styles.wrapper, isMounted && styles.wrapper_hydrated)
        : undefined;

    /**
     * Loading state - only shown when no SSR data was provided.
     */
    if (effectiveStatus === 'idle' || effectiveStatus === 'loading') {
        return (
            <div className={wrapperClass} data-hydrated={isMounted ? 'true' : undefined}>
                <Card elevated>
                    <div className={styles.container}>
                        <div className={styles.loading_state}>
                            <h2 className={styles.title}>Current Block</h2>
                            <span className={styles.loading_message}>Waiting for blockchain data...</span>
                        </div>
                    </div>
                </Card>
            </div>
        );
    }

    /**
     * Error state - blockchain data failed to load or is unavailable.
     */
    if (effectiveStatus === 'error' || !latestBlock) {
        return (
            <div className={wrapperClass} data-hydrated={isMounted ? 'true' : undefined}>
                <Card elevated tone="muted">
                    <div className={styles.container}>
                        <div className={styles.error_state}>
                            <h2 className={styles.title}>Current Block</h2>
                            <span className={styles.error_message}>No block data available</span>
                        </div>
                    </div>
                </Card>
            </div>
        );
    }

    /**
     * Success state - compact block display with expandable details.
     */
    return (
        <div className={wrapperClass} data-hydrated={isMounted ? 'true' : undefined}>
            <Card elevated>
                <div className={styles.container}>
                    {/* Compact Header Row */}
                    <div className={styles.header}>
                        <div className={styles.header_left}>
                            {/* Title + Block Number (always same row) */}
                            <div className={styles.title_row}>
                                <h2 className={styles.title}>Current Block</h2>
                                <span className={cn(styles.block_number, styles.metric_value_accent)}>
                                    {latestBlock.blockNumber.toLocaleString()}
                                </span>
                            </div>

                            {/* Transaction count (wraps on mobile) */}
                            <div className={styles.tx_metric}>
                                <span className={styles.metric_label}>TXs</span>
                                <span className={styles.metric_value}>
                                    {latestBlock.transactionCount.toLocaleString()}
                                </span>
                            </div>
                        </div>

                        <div className={styles.header_right}>
                            {isMounted && (
                                <Badge
                                    tone={realtime.tone}
                                    showLiveIndicator={realtime.label === 'Live'}
                                    aria-live="polite"
                                    suppressHydrationWarning
                                >
                                    <span suppressHydrationWarning>{realtime.label}</span>
                                    {realtime.latencyMs !== null && (
                                        <span suppressHydrationWarning>
                                            {' '}{Math.round(realtime.latencyMs)}ms
                                        </span>
                                    )}
                                </Badge>
                            )}

                            <button
                                className={cn(
                                    styles.expand_toggle,
                                    isExpanded && styles.expand_toggle_expanded
                                )}
                                onClick={() => setIsExpanded(!isExpanded)}
                                aria-label={isExpanded ? 'Collapse details' : 'Expand details'}
                                aria-expanded={isExpanded}
                            >
                                <ChevronDown
                                    size={14}
                                    className={cn(
                                        styles.expand_icon,
                                        isExpanded && styles.expand_icon_rotated
                                    )}
                                />
                            </button>
                        </div>
                    </div>


                    {/* Expandable Details */}
                    {isExpanded && (
                        <div className={styles.expanded_content}>
                            {/* Block Statistics */}
                            <div className={styles.section}>
                                <h3 className={styles.section_title}>Block Statistics</h3>
                                <div className={styles.mini_stats_grid}>
                                    <MiniStatCard label="Transfers" value={latestBlock.stats.transfers} />
                                    <MiniStatCard label="Contracts" value={latestBlock.stats.contractCalls} />
                                    <MiniStatCard label="Delegations" value={latestBlock.stats.delegations} />
                                    <MiniStatCard label="Stakes" value={latestBlock.stats.stakes} />
                                    <MiniStatCard label="Tokens" value={latestBlock.stats.tokenCreations} />
                                </div>
                            </div>

                            {/* Resource Usage */}
                            {(latestBlock.stats.totalEnergyUsed > 0 || latestBlock.stats.totalBandwidthUsed > 0) && (
                                <div className={styles.section}>
                                    <h3 className={styles.section_title}>Resources</h3>
                                    <div className={styles.mini_stats_grid}>
                                        <MiniStatCard
                                            label="Energy"
                                            value={formatLargeNumber(latestBlock.stats.totalEnergyUsed)}
                                        />
                                        <MiniStatCard
                                            label="Cost"
                                            value={`${latestBlock.stats.totalEnergyCost.toFixed(2)} TRX`}
                                        />
                                        <MiniStatCard
                                            label="Bandwidth"
                                            value={formatLargeNumber(latestBlock.stats.totalBandwidthUsed)}
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Transaction Graph Toggle */}
                            <div className={styles.section}>
                                <button
                                    className={cn(
                                        styles.expand_toggle,
                                        styles.graph_toggle_button,
                                        showGraph && styles.expand_toggle_expanded
                                    )}
                                    onClick={() => setShowGraph(!showGraph)}
                                    aria-label={showGraph ? 'Hide transaction chart' : 'Show transaction chart'}
                                    aria-expanded={showGraph}
                                >
                                    <span className={styles.graph_toggle_text}>
                                        {showGraph ? 'Hide' : 'Show'} Transaction Chart
                                    </span>
                                    <ChevronDown
                                        size={12}
                                        className={cn(
                                            styles.expand_icon,
                                            showGraph && styles.expand_icon_rotated
                                        )}
                                    />
                                </button>
                            </div>

                            {/* Transaction Graph */}
                            {showGraph && (
                                <div className={styles.graph_section}>
                                    <div className={styles.graph_header}>
                                        <h3 className={styles.section_title}>Transaction Volume</h3>
                                        <div className={styles.period_selector}>
                                            {(['live', 1, 7, 30] as const).map(period => (
                                                <button
                                                    key={period}
                                                    className={cn(
                                                        styles.period_button,
                                                        selectedPeriod === period && styles.period_button_active
                                                    )}
                                                    onClick={() => setSelectedPeriod(period)}
                                                >
                                                    {period === 'live' ? 'Live' : `${period}d`}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div className={styles.graph_content}>
                                        {chartLoading && (
                                            <div className={styles.graph_loading}>Loading...</div>
                                        )}
                                        {chartError && !chartLoading && (
                                            <div className={styles.graph_error}>Failed to load data</div>
                                        )}
                                        {!chartError && chartData && chartData.length > 0 && (
                                            <LineChart
                                                key={selectedPeriod}
                                                height={200}
                                                series={[{
                                                    id: 'transactions',
                                                    label: 'Transactions',
                                                    data: chartData.map(point => ({
                                                        date: point.date,
                                                        value: point.transactions
                                                    })),
                                                    color: primaryColor
                                                }]}
                                                yAxisFormatter={formatLargeNumber}
                                                xAxisFormatter={(date) => formatChartDate(date, selectedPeriod, hasReceivedLiveData)}
                                            />
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </Card>
        </div>
    );
}

/**
 * Properties for the MiniStatCard component.
 */
interface MiniStatCardProps {
    /** The descriptive label for the statistic */
    label: string;
    /** The numeric or pre-formatted string value to display */
    value: number | string;
}

/**
 * MiniStatCard - Compact statistics card for detailed metrics.
 *
 * @param props - Statistic label and value
 * @returns A compact statistics card element
 */
function MiniStatCard({ label, value }: MiniStatCardProps) {
    const formattedValue = typeof value === 'number' ? value.toLocaleString() : value;

    return (
        <div className={styles.mini_stat_card}>
            <div className={styles.mini_stat_label}>{label}</div>
            <div className={styles.mini_stat_value}>{formattedValue}</div>
        </div>
    );
}

/**
 * Formats large numbers with abbreviated suffixes for compact display.
 *
 * Converts large numeric values into human-readable abbreviated formats
 * (K for thousands, M for millions, B for billions) to fit in constrained
 * UI spaces like stat cards and chart axes.
 *
 * @param num - The number to format
 * @returns Formatted string with abbreviated suffix (e.g., "1.5M", "42K")
 */
function formatLargeNumber(num: number): string {
    if (num >= 1_000_000_000) {
        return (num / 1_000_000_000).toFixed(1) + 'B';
    }
    if (num >= 1_000_000) {
        return (num / 1_000_000).toFixed(1) + 'M';
    }
    if (num >= 1_000) {
        return (num / 1_000).toFixed(1) + 'K';
    }
    return num.toLocaleString();
}

/**
 * Formats block timestamp into human-readable local time.
 *
 * Converts ISO timestamp strings from block data into localized time
 * representations for display in the UI. Falls back to the raw timestamp
 * string if parsing fails.
 *
 * @param timestamp - ISO timestamp string from block data
 * @returns Localized time string (e.g., "2:34:56 PM")
 */
function formatBlockTime(timestamp: string): string {
    try {
        const date = new Date(timestamp);
        return date.toLocaleTimeString();
    } catch {
        return timestamp;
    }
}

/**
 * Formats timestamp as human-readable relative time.
 *
 * Calculates the time difference between the given timestamp and now,
 * returning a compact relative time string for showing update freshness.
 * Handles seconds, minutes, and hours with appropriate abbreviations.
 *
 * @param timestamp - ISO timestamp string to format
 * @returns Relative time string (e.g., "just now", "42s ago", "5m ago", "2h ago")
 */
function formatRelativeTime(timestamp: string): string {
    try {
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffSeconds = Math.floor(diffMs / 1000);

        if (diffSeconds < 10) return 'just now';
        if (diffSeconds < 60) return `${diffSeconds}s ago`;

        const diffMinutes = Math.floor(diffSeconds / 60);
        if (diffMinutes < 60) return `${diffMinutes}m ago`;

        const diffHours = Math.floor(diffMinutes / 60);
        return `${diffHours}h ago`;
    } catch {
        return 'recently';
    }
}

/**
 * Formats chart x-axis date labels based on selected time period.
 *
 * Adapts date formatting to the context: live mode shows relative times
 * initially then switches to clock times after receiving live data,
 * daily view shows times, and weekly/monthly views show dates.
 *
 * @param date - The date to format for the chart axis
 * @param selectedPeriod - The currently selected time period ('live', 1, 7, or 30 days)
 * @param hasReceivedLiveData - Whether live WebSocket data has been received
 * @returns Formatted date string appropriate for the chart context
 */
function formatChartDate(
    date: Date,
    selectedPeriod: 'live' | 1 | 7 | 30,
    hasReceivedLiveData: boolean
): string {
    if (selectedPeriod === 'live') {
        if (!hasReceivedLiveData) {
            const now = Date.now();
            const diffMs = now - date.getTime();
            const diffMinutes = Math.floor(diffMs / (1000 * 60));
            if (diffMinutes < 30) return 'Now';
            return `${diffMinutes}m`;
        }
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (selectedPeriod === 1) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
