'use client';

import { memo } from 'react';
import type { IFrontendPluginContext } from '@tronrelic/types';
import { Zap, Gauge, BarChart3, HelpCircle, AlertCircle } from 'lucide-react';
import styles from './ResourceTrackingPage.module.css';

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

type TimePeriod = '1d' | '7d' | '30d' | '6m';

/**
 * Resource Delegations Card Component.
 *
 * Self-contained card component that manages the metrics visualization and time period controls.
 * This component handles all chart rendering and user interactions, while remaining independent
 * of the page-level data fetching and WebSocket subscriptions.
 *
 * Performance optimizations:
 * - Memoized with React.memo to prevent unnecessary re-renders
 * - Only re-renders when props actually change (period, chartSeries, toggle states)
 * - Chart smoothly updates when period changes without flashing the entire component
 *
 * Component boundaries:
 * - Keeps page-level title/description static (not re-rendering with state changes)
 * - Encapsulates all chart-specific logic within a focused, testable component
 * - Makes the time period selector part of the card's internal state, not the page
 *
 * @param props - Component props
 * @param props.context - Frontend plugin context with UI components and charts
 * @param props.period - Selected time period
 * @param props.setPeriod - Function to update time period
 * @param props.chartSeries - Chart series data
 * @param props.timeRange - Time range for X-axis bounds
 * @param props.yAxisMin - Minimum Y-axis value
 * @param props.yAxisMax - Maximum Y-axis value
 * @param props.showEnergyDelegated - Whether to show energy delegated line
 * @param props.setShowEnergyDelegated - Function to toggle energy delegated line
 * @param props.showEnergyReclaimed - Whether to show energy reclaimed line
 * @param props.setShowEnergyReclaimed - Function to toggle energy reclaimed line
 * @param props.showNetEnergy - Whether to show net energy line
 * @param props.setShowNetEnergy - Function to toggle net energy line
 * @param props.showBandwidthDelegated - Whether to show bandwidth delegated line
 * @param props.setShowBandwidthDelegated - Function to toggle bandwidth delegated line
 * @param props.showBandwidthReclaimed - Whether to show bandwidth reclaimed line
 * @param props.setShowBandwidthReclaimed - Function to toggle bandwidth reclaimed line
 * @param props.showNetBandwidth - Whether to show net bandwidth line
 * @param props.setShowNetBandwidth - Function to toggle net bandwidth line
 * @param props.loading - Whether data is currently loading
 * @param props.error - Error message if data load failed
 * @param props.onRetry - Function to retry loading data after an error
 */
const ResourceDelegationsCardComponent = ({
    context,
    period,
    setPeriod,
    chartSeries,
    timeRange,
    yAxisMin,
    yAxisMax,
    showEnergyDelegated,
    setShowEnergyDelegated,
    showEnergyReclaimed,
    setShowEnergyReclaimed,
    showNetEnergy,
    setShowNetEnergy,
    showBandwidthDelegated,
    setShowBandwidthDelegated,
    showBandwidthReclaimed,
    setShowBandwidthReclaimed,
    showNetBandwidth,
    setShowNetBandwidth,
    loading,
    error,
    onRetry
}: {
    context: IFrontendPluginContext;
    period: TimePeriod;
    setPeriod: (period: TimePeriod) => void;
    chartSeries: any[];
    timeRange: { minDate: Date; maxDate: Date };
    yAxisMin: number | undefined;
    yAxisMax: number | undefined;
    showEnergyDelegated: boolean;
    setShowEnergyDelegated: (show: boolean) => void;
    showEnergyReclaimed: boolean;
    setShowEnergyReclaimed: (show: boolean) => void;
    showNetEnergy: boolean;
    setShowNetEnergy: (show: boolean) => void;
    showBandwidthDelegated: boolean;
    setShowBandwidthDelegated: (show: boolean) => void;
    showBandwidthReclaimed: boolean;
    setShowBandwidthReclaimed: (show: boolean) => void;
    showNetBandwidth: boolean;
    setShowNetBandwidth: (show: boolean) => void;
    loading: boolean;
    error: string | null;
    onRetry: () => void;
}) => {
    const { charts, ui } = context;
    const Card = ui.Card as ICard;

    return (
        <Card elevated className={styles.container}>
            {/* Card Header */}
            <div className={styles.cardHeader}>
                <h2 className={styles.cardTitle}>
                    <Zap size={24} style={{ display: 'inline-block', marginRight: '0.5rem', verticalAlign: 'middle' }} />
                    Resource Delegations
                </h2>
                <p className={styles.cardSubtitle}>
                    Monitor TRON resource delegation and reclaim patterns (millions of TRX equivalence)
                    <span
                        className={styles.helpIcon}
                        role="img"
                        aria-label="Information"
                        title="Values shown are not raw energy values but the equivalent TRX staked to obtain such energy"
                    >
                        <HelpCircle
                            size={16}
                            style={{
                                display: 'inline-block',
                                marginLeft: '0.35rem',
                                verticalAlign: 'middle',
                                cursor: 'help',
                                opacity: 0.7
                            }}
                        />
                    </span>
                </p>
            </div>

            {/* Controls: Time Period + Line Toggles */}
            <div className={styles.controls}>
                {/* Time Period Selector */}
                <div className={styles.controlRow}>
                    <div className={styles.buttonGroup}>
                        <button
                            className={`${styles.periodButton} ${period === '1d' ? styles['periodButton--active'] : ''}`}
                            onClick={() => setPeriod('1d')}
                            aria-label="Show data for 1 day"
                            aria-pressed={period === '1d'}
                        >
                            1 Day
                        </button>
                        <button
                            className={`${styles.periodButton} ${period === '7d' ? styles['periodButton--active'] : ''}`}
                            onClick={() => setPeriod('7d')}
                            aria-label="Show data for 7 days"
                            aria-pressed={period === '7d'}
                        >
                            7 Days
                        </button>
                        <button
                            className={`${styles.periodButton} ${period === '30d' ? styles['periodButton--active'] : ''}`}
                            onClick={() => setPeriod('30d')}
                            aria-label="Show data for 30 days"
                            aria-pressed={period === '30d'}
                        >
                            30 Days
                        </button>
                        <button
                            className={`${styles.periodButton} ${period === '6m' ? styles['periodButton--active'] : ''}`}
                            onClick={() => setPeriod('6m')}
                            aria-label="Show data for 6 months"
                            aria-pressed={period === '6m'}
                        >
                            6 Months
                        </button>
                    </div>
                </div>

                {/* Line Toggles */}
                <div className={styles.controlRow}>
                    <div className={styles.toggleGroup}>
                        <label className={styles.toggle}>
                            <input
                                type="checkbox"
                                checked={showEnergyDelegated}
                                onChange={(e) => setShowEnergyDelegated(e.target.checked)}
                                aria-label="Toggle Energy Delegated line visibility"
                            />
                            <span className={`${styles.toggleLabel} ${styles.toggleLabelEnergyDelegated}`}>
                                <Zap size={14} style={{ display: 'inline-block', marginRight: '0.25rem', verticalAlign: 'middle' }} />
                                Delegated
                            </span>
                        </label>
                        <label className={styles.toggle}>
                            <input
                                type="checkbox"
                                checked={showEnergyReclaimed}
                                onChange={(e) => setShowEnergyReclaimed(e.target.checked)}
                                aria-label="Toggle Energy Reclaimed line visibility"
                            />
                            <span className={`${styles.toggleLabel} ${styles.toggleLabelEnergyReclaimed}`}>
                                <Zap size={14} style={{ display: 'inline-block', marginRight: '0.25rem', verticalAlign: 'middle' }} />
                                Reclaimed
                            </span>
                        </label>
                        <label className={styles.toggle}>
                            <input
                                type="checkbox"
                                checked={showNetEnergy}
                                onChange={(e) => setShowNetEnergy(e.target.checked)}
                                aria-label="Toggle Net Energy line visibility"
                            />
                            <span className={`${styles.toggleLabel} ${styles.toggleLabelNetEnergy}`}>
                                <Zap size={14} style={{ display: 'inline-block', marginRight: '0.25rem', verticalAlign: 'middle' }} />
                                Net
                            </span>
                        </label>
                        <label className={styles.toggle}>
                            <input
                                type="checkbox"
                                checked={showBandwidthDelegated}
                                onChange={(e) => setShowBandwidthDelegated(e.target.checked)}
                                aria-label="Toggle Bandwidth Delegated line visibility"
                            />
                            <span className={`${styles.toggleLabel} ${styles.toggleLabelBandwidthDelegated}`}>
                                <Gauge size={14} style={{ display: 'inline-block', marginRight: '0.25rem', verticalAlign: 'middle' }} />
                                Delegated
                            </span>
                        </label>
                        <label className={styles.toggle}>
                            <input
                                type="checkbox"
                                checked={showBandwidthReclaimed}
                                onChange={(e) => setShowBandwidthReclaimed(e.target.checked)}
                                aria-label="Toggle Bandwidth Reclaimed line visibility"
                            />
                            <span className={`${styles.toggleLabel} ${styles.toggleLabelBandwidthReclaimed}`}>
                                <Gauge size={14} style={{ display: 'inline-block', marginRight: '0.25rem', verticalAlign: 'middle' }} />
                                Reclaimed
                            </span>
                        </label>
                        <label className={styles.toggle}>
                            <input
                                type="checkbox"
                                checked={showNetBandwidth}
                                onChange={(e) => setShowNetBandwidth(e.target.checked)}
                                aria-label="Toggle Net Bandwidth line visibility"
                            />
                            <span className={`${styles.toggleLabel} ${styles.toggleLabelNetBandwidth}`}>
                                <Gauge size={14} style={{ display: 'inline-block', marginRight: '0.25rem', verticalAlign: 'middle' }} />
                                Net
                            </span>
                        </label>
                    </div>
                </div>
            </div>

            {/* Chart */}
            <div className={styles.chartContainer}>
                {loading ? (
                    <div className={styles.skeletonLoader} style={{ height: '400px' }} />
                ) : error ? (
                    <div className={styles.errorContainer}>
                        <AlertCircle size={48} color="var(--color-danger, #ef4444)" />
                        <p className={styles.errorText}>{error}</p>
                        <button className="btn btn--secondary" onClick={onRetry}>
                            Retry
                        </button>
                    </div>
                ) : chartSeries.length > 0 ? (
                    <charts.LineChart
                        series={chartSeries}
                        height={400}
                        yAxisFormatter={(value) => `${Math.round(value).toLocaleString()}`}
                        xAxisFormatter={(date) => {
                            const dateStr = date.toLocaleDateString();
                            const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
                            return `${dateStr} ${timeStr}`;
                        }}
                        minDate={timeRange.minDate}
                        maxDate={timeRange.maxDate}
                        yAxisMin={yAxisMin}
                        yAxisMax={yAxisMax}
                    />
                ) : (
                    <div className={styles.noData}>
                        <BarChart3 size={64} style={{ opacity: 0.3, marginBottom: 'var(--spacing-md)' }} />
                        <p>No data available or all lines are hidden</p>
                        <p className={styles.noDataHint}>
                            Select at least one line to display the chart
                        </p>
                    </div>
                )}
            </div>
        </Card>
    );
};

/**
 * Memoized wrapper for ResourceDelegationsCardComponent.
 *
 * Prevents unnecessary re-renders when parent component updates. The component
 * only re-renders when its props actually change (period, chartSeries, toggle states).
 *
 * This optimization eliminates the visual "flash" that occurs when the period selector
 * changes, as only the chart data needs to update, not the entire component tree.
 *
 * Without memoization, every parent state change triggers a full re-render of this
 * component even when the props haven't changed, causing unnecessary DOM updates
 * and visual flickering.
 */
export const ResourceDelegationsCard = memo(ResourceDelegationsCardComponent);

/**
 * Legacy export name for backwards compatibility.
 *
 * Maintains the old ResourceTrackingCard name to avoid breaking existing imports
 * while establishing ResourceDelegationsCard as the preferred component name.
 *
 * @deprecated Use ResourceDelegationsCard instead
 */
export const ResourceTrackingCard = ResourceDelegationsCard;
