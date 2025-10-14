'use client';

import { useState, useEffect } from 'react';
import { useAppSelector } from '../../../../store/hooks';
import { Card } from '../../../../components/ui/Card';
import { Badge } from '../../../../components/ui/Badge';
import { cn } from '../../../../lib/cn';
import { useRealtimeStatus } from '../../../realtime/hooks/useRealtimeStatus';
import { LineChart } from '../../../charts/components/LineChart/LineChart';
import { useTransactionTimeseries } from '../../hooks/useTransactionTimeseries';
import styles from './CurrentBlock.module.css';

/**
 * CurrentBlock - Displays the currently processed blockchain block with detailed statistics
 *
 * This component subscribes to the blockchain Redux state and displays real-time
 * updates of the latest processed block. It shows:
 * - Block number and transaction count (highlighted metrics, with expandable graph)
 * - Detailed statistics (transfers, contract calls, delegations, stakes, etc.)
 * - Resource usage (energy and bandwidth consumption)
 * - Block timestamp and update freshness indicator
 * - Expandable transaction timeseries chart (1d/7d/30d views)
 *
 * The component handles three states:
 * - **Loading** - Shows "Waiting for blockchain data" placeholder
 * - **Error/No data** - Shows "No block data available" message
 * - **Success** - Displays complete block information with metrics
 *
 * The block data is received via Socket.IO events (block:new) and stored in Redux
 * by the SocketBridge component, which ensures real-time updates as blocks are
 * processed by the backend blockchain service.
 *
 * When the user clicks the "Transactions" stat card, an interactive timeseries chart
 * expands below showing transaction volume over time with period selection (1d/7d/30d).
 * Clicking again collapses the chart for a clean, compact view.
 *
 * The component is designed to be relocatable and can be placed anywhere in the
 * application layout. It uses the elevated Card variant for visual prominence.
 *
 * @returns A card displaying current block information or appropriate loading/error state
 */
export function CurrentBlock() {
    const latestBlock = useAppSelector(state => state.blockchain.latestBlock);
    const status = useAppSelector(state => state.blockchain.status);
    const lastUpdated = useAppSelector(state => state.blockchain.lastUpdated);
    const realtime = useRealtimeStatus();
    const [isMounted, setIsMounted] = useState(false);
    const [showGraph, setShowGraph] = useState(false);
    const [selectedPeriod, setSelectedPeriod] = useState<1 | 7 | 30>(7);

    const { data: timeseriesData, loading: timeseriesLoading, error: timeseriesError } = useTransactionTimeseries(selectedPeriod);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    /**
     * Loading state - blockchain data is being fetched.
     */
    if (status === 'idle' || status === 'loading') {
        return (
            <Card elevated>
                <div className={styles['loading-state']}>
                    <h2 className={styles.header__title}>Current Block</h2>
                    <div className={styles['loading-state__message']}>
                        Waiting for blockchain data...
                    </div>
                </div>
            </Card>
        );
    }

    /**
     * Error state - blockchain data failed to load or is unavailable.
     */
    if (status === 'error' || !latestBlock) {
        return (
            <Card elevated tone="muted">
                <div className={styles['error-state']}>
                    <h2 className={styles.header__title}>Current Block</h2>
                    <div className={styles['error-state__message']}>
                        No block data available
                    </div>
                </div>
            </Card>
        );
    }

    /**
     * Success state - display full block information.
     */
    return (
        <Card elevated>
            <div className={styles.container}>
                {/* Header */}
                <div className={styles.header}>
                    <div className={styles['header-left']}>
                        <h2 className={styles.header__title}>
                            Current Block
                            <span className={styles['header-blocktime']}>
                                {formatBlockTime(latestBlock.timestamp)}
                            </span>
                        </h2>
                        {lastUpdated && (
                            <div className={styles.header__timestamp}>
                                Updated {formatRelativeTime(lastUpdated)}
                            </div>
                        )}
                    </div>
                    {isMounted && (
                        <Badge tone={realtime.tone} aria-live="polite" suppressHydrationWarning>
                            <span suppressHydrationWarning>{realtime.label}</span>
                            {realtime.latencyMs !== null && (
                                <span suppressHydrationWarning>
                                    {' '}{Math.round(realtime.latencyMs)} ms
                                </span>
                            )}
                        </Badge>
                    )}
                </div>

                {/* Block Number and Transaction Count */}
                <div className={styles['stats-grid']}>
                    <StatCard
                        label="Block Number"
                        value={latestBlock.blockNumber.toLocaleString()}
                        tone="accent"
                    />
                    <StatCard
                        label="Transactions"
                        value={latestBlock.transactionCount.toLocaleString()}
                        clickable
                        expanded={showGraph}
                        onClick={() => setShowGraph(!showGraph)}
                    />
                </div>

                {/* Transaction Timeseries Graph (Expandable) */}
                {showGraph && (
                    <div className={styles.section}>
                        <div className={styles['graph-header']}>
                            <h3 className={styles.section__title}>Transaction Volume</h3>
                            <div className={styles['period-selector']}>
                                <button
                                    className={cn(
                                        styles['period-button'],
                                        selectedPeriod === 1 && styles['period-button--active']
                                    )}
                                    onClick={() => setSelectedPeriod(1)}
                                >
                                    1d
                                </button>
                                <button
                                    className={cn(
                                        styles['period-button'],
                                        selectedPeriod === 7 && styles['period-button--active']
                                    )}
                                    onClick={() => setSelectedPeriod(7)}
                                >
                                    7d
                                </button>
                                <button
                                    className={cn(
                                        styles['period-button'],
                                        selectedPeriod === 30 && styles['period-button--active']
                                    )}
                                    onClick={() => setSelectedPeriod(30)}
                                >
                                    30d
                                </button>
                            </div>
                        </div>

                        {timeseriesLoading && (
                            <div className={styles['graph-loading']}>
                                Loading transaction data...
                            </div>
                        )}

                        {timeseriesError && (
                            <div className={styles['graph-error']}>
                                Failed to load transaction data: {timeseriesError}
                            </div>
                        )}

                        {!timeseriesLoading && !timeseriesError && timeseriesData && (
                            <LineChart
                                height={280}
                                series={[
                                    {
                                        id: 'transactions',
                                        label: 'Transactions',
                                        data: timeseriesData.map(point => ({
                                            date: point.date,
                                            value: point.transactions
                                        })),
                                        color: '#7C9BFF'
                                    }
                                ]}
                                yAxisFormatter={(value) => formatLargeNumber(value)}
                                xAxisFormatter={(date) => {
                                    if (selectedPeriod === 1) {
                                        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                                    }
                                    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
                                }}
                            />
                        )}
                    </div>
                )}

                {/* Detailed Statistics */}
                <div className={styles.section}>
                    <h3 className={styles.section__title}>Block Statistics</h3>
                    <div className={styles['mini-stats-grid']}>
                        <MiniStatCard label="Transfers" value={latestBlock.stats.transfers} />
                        <MiniStatCard label="Contract Calls" value={latestBlock.stats.contractCalls} />
                        <MiniStatCard label="Delegations" value={latestBlock.stats.delegations} />
                        <MiniStatCard label="Stakes" value={latestBlock.stats.stakes} />
                        <MiniStatCard label="Token Creations" value={latestBlock.stats.tokenCreations} />
                    </div>
                </div>

                {/* Resource Usage */}
                {(latestBlock.stats.totalEnergyUsed > 0 || latestBlock.stats.totalBandwidthUsed > 0) && (
                    <div className={styles.section}>
                        <h3 className={styles.section__title}>Resource Usage</h3>
                        <div className={styles['mini-stats-grid']}>
                            <MiniStatCard
                                label="Energy Used"
                                value={formatLargeNumber(latestBlock.stats.totalEnergyUsed)}
                            />
                            <MiniStatCard
                                label="Energy Cost"
                                value={`${latestBlock.stats.totalEnergyCost.toFixed(2)} TRX`}
                            />
                            <MiniStatCard
                                label="Bandwidth"
                                value={formatLargeNumber(latestBlock.stats.totalBandwidthUsed)}
                            />
                        </div>
                    </div>
                )}
            </div>
        </Card>
    );
}

/**
 * Properties for the StatCard component.
 */
interface StatCardProps {
    /** The descriptive label for the statistic */
    label: string;
    /** The statistic value to display */
    value: string;
    /** Visual emphasis level (default or accent) */
    tone?: 'default' | 'accent';
    /** Whether the card is clickable (shows pointer cursor and hover effect) */
    clickable?: boolean;
    /** Whether the associated content is expanded (shows expand/collapse icon) */
    expanded?: boolean;
    /** Click handler for expandable cards */
    onClick?: () => void;
}

/**
 * StatCard - Display a statistics card with label and value
 *
 * Renders a bordered card containing a label and formatted value, with optional
 * accent styling to highlight important metrics like block numbers. When clickable
 * is true, the card becomes interactive with hover effects and an expand/collapse
 * icon, typically used to toggle associated content like timeseries graphs.
 *
 * @param props - Statistic label, value, visual tone, and interaction handlers
 * @returns A formatted statistics card element
 */
function StatCard({ label, value, tone = 'default', clickable = false, expanded = false, onClick }: StatCardProps) {
    const cardContent = (
        <>
            <div className={styles['stat-card__label']}>
                {label}
                {clickable && (
                    <span className={styles['stat-card__icon']}>
                        {expanded ? '▼' : '▶'}
                    </span>
                )}
            </div>
            <div className={styles['stat-card__value']}>{value}</div>
        </>
    );

    if (clickable && onClick) {
        return (
            <button
                className={cn(
                    styles['stat-card'],
                    styles['stat-card--clickable'],
                    tone === 'accent' && styles['stat-card--accent'],
                    expanded && styles['stat-card--expanded']
                )}
                onClick={onClick}
            >
                {cardContent}
            </button>
        );
    }

    return (
        <div className={cn(
            styles['stat-card'],
            tone === 'accent' && styles['stat-card--accent']
        )}>
            {cardContent}
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
 * MiniStatCard - Display a compact statistics card with label and numeric value
 *
 * Renders a smaller card optimized for displaying multiple related metrics in a
 * grid layout. Automatically formats numbers with locale-aware separators.
 *
 * @param props - Statistic label and value
 * @returns A compact statistics card element
 */
function MiniStatCard({ label, value }: MiniStatCardProps) {
    const formattedValue = typeof value === 'number' ? value.toLocaleString() : value;

    return (
        <div className={styles['mini-stat-card']}>
            <div className={styles['mini-stat-card__label']}>{label}</div>
            <div className={styles['mini-stat-card__value']}>{formattedValue}</div>
        </div>
    );
}

/**
 * Formats large numbers with abbreviated suffixes (K, M, B).
 *
 * Converts large numeric values into human-readable abbreviated formats for
 * compact display in UI components. Numbers under 1000 are displayed as-is
 * with locale formatting.
 *
 * @param num - The number to format
 * @returns Formatted string with abbreviated suffix
 */
function formatLargeNumber(num: number): string {
    if (num >= 1_000_000_000) {
        return (num / 1_000_000_000).toFixed(2) + 'B';
    }
    if (num >= 1_000_000) {
        return (num / 1_000_000).toFixed(2) + 'M';
    }
    if (num >= 1_000) {
        return (num / 1_000).toFixed(2) + 'K';
    }
    return num.toLocaleString();
}

/**
 * Formats block timestamp into human-readable date and time.
 *
 * Converts ISO timestamp strings into localized date and time representations
 * for display in the block summary UI. Falls back to raw timestamp string
 * if parsing fails.
 *
 * @param timestamp - ISO timestamp string from block data
 * @returns Formatted date and time string
 */
function formatBlockTime(timestamp: string): string {
    try {
        const date = new Date(timestamp);
        return date.toLocaleString();
    } catch {
        return timestamp;
    }
}

/**
 * Formats timestamp as relative time (e.g., "2 seconds ago", "5 minutes ago").
 *
 * Calculates the time difference between the given timestamp and now, returning
 * a human-readable relative time string for showing update freshness. Handles
 * seconds, minutes, and hours with proper singular/plural forms.
 *
 * @param timestamp - ISO timestamp string to format
 * @returns Relative time string
 */
function formatRelativeTime(timestamp: string): string {
    try {
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffSeconds = Math.floor(diffMs / 1000);

        if (diffSeconds < 10) {
            return 'just now';
        }
        if (diffSeconds < 60) {
            return `${diffSeconds} seconds ago`;
        }

        const diffMinutes = Math.floor(diffSeconds / 60);
        if (diffMinutes < 60) {
            return `${diffMinutes} ${diffMinutes === 1 ? 'minute' : 'minutes'} ago`;
        }

        const diffHours = Math.floor(diffMinutes / 60);
        return `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
    } catch {
        return 'recently';
    }
}
