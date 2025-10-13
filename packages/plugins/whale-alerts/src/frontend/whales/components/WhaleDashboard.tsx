'use client';

import { useEffect, useMemo, useState } from 'react';
import type { IFrontendPluginContext } from '@tronrelic/types';
import type { IWhaleTimeseriesPoint, IWhaleHighlight } from '../../../shared/types';

/**
 * Chart-specific timeseries point that extends backend data with a value field.
 *
 * The LineChart component expects a 'value' field, so we transform the backend's
 * 'volume' field to 'value' for chart compatibility while preserving all other fields.
 */
interface ChartTimeseriesPoint extends IWhaleTimeseriesPoint {
    value: number;
}

/**
 * Props expected by the whale dashboard container.
 *
 * Preloaded time series and highlight data ensure the dashboard has useful
 * content while the websocket subscription warms up. The injected plugin context
 * provides access to shared UI components, chart helpers, and the websocket client.
 */
interface WhaleDashboardProps {
    initialSeries: IWhaleTimeseriesPoint[];
    initialHighlights: IWhaleHighlight[];
    context: IFrontendPluginContext;
}

/**
 * Predefined time ranges (in days) available for whale activity charting.
 *
 * These ranges balance useful operational windows (weekly/biweekly reviews,
 * monthly trends, and quarterly patterns) with backend query performance.
 * Longer ranges require more aggregation but reveal seasonal whale behavior,
 * while shorter ranges highlight immediate capital flow changes.
 */
const RANGE_OPTIONS = [7, 14, 30, 60];

/**
 * Format large TRX amounts so they are easier to scan.
 *
 * The dashboard surfaces very large values; removing decimals keeps the card
 * summaries compact. Uses Intl.NumberFormat to respect locale-specific grouping.
 *
 * @param value - The raw TRX amount that needs a human-friendly representation
 * @returns Formatted string suitable for display in the UI cards and highlights
 */
function formatAmount(value: number) {
    const formatter = new Intl.NumberFormat('en-US', {
        maximumFractionDigits: 0
    });
    return formatter.format(value);
}

/**
 * Whale dashboard component responsible for charting and live whale highlights.
 *
 * The component hydrates with server-provided summaries, resubscribes to websocket
 * whale notifications, and keeps the chart in sync with user-selected ranges.
 * This design lets operators spot capital flow spikes quickly without leaving
 * the plugin.
 *
 * @param initialSeries - Historical whale activity used to plot the chart immediately
 * @param initialHighlights - Recent whale transfers displayed in the highlights list
 * @param context - Plugin context supplying UI primitives, API client, and websocket
 * @returns JSX element containing the whale analytics dashboard
 */
export function WhaleDashboard({ initialSeries, initialHighlights, context }: WhaleDashboardProps) {
    // Transform initial series to include value field for chart
    const initialChartSeries: ChartTimeseriesPoint[] = initialSeries.map(point => ({
        ...point,
        value: point.volume
    }));

    const [series, setSeries] = useState<ChartTimeseriesPoint[]>(initialChartSeries);
    const [highlights, setHighlights] = useState(initialHighlights);
    const [selectedRange, setSelectedRange] = useState(14);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const { ui, charts, api, websocket } = context;

    useEffect(() => {
        // Refresh highlights once on mount to ensure freshness
        void (async () => {
            try {
                const data = await api.get('/plugins/whale-alerts/highlights', { limit: 8 });
                setHighlights(data.highlights || []);
            } catch (highlightError) {
                console.error(highlightError);
            }
        })();
    }, [api]);

    // Subscribe to whale transaction room and listen for real-time large transfers
    useEffect(() => {
        console.log('🔍 WebSocket Debug:', {
            socketConnected: websocket.isConnected(),
            socketId: websocket.socket.id
        });

        /**
         * Handle incoming whale transaction websocket payloads.
         *
         * Websocket events arrive asynchronously, so the handler creates a normalized
         * highlight record and prepends it to the local state. Limiting the list length
         * keeps the sidebar focused on the freshest activity without unbounded growth.
         *
         * @param payload - Raw websocket payload describing the whale transfer
         */
        const handleNewWhaleTransaction = (payload: any) => {
            console.log('🐋 Real-time whale transaction received:', payload);

            // Create a new highlight from the WebSocket event
            const newHighlight: IWhaleHighlight = {
                txId: payload.txId,
                timestamp: new Date(payload.timestamp || Date.now()),
                amountTRX: payload.amountTRX || 0,
                fromAddress: payload.from?.address || payload.fromAddress || 'Unknown',
                toAddress: payload.to?.address || payload.toAddress || 'Unknown',
                memo: payload.memo
            };

            // Prepend to highlights list and limit to 8 items
            setHighlights(prev => [newHighlight, ...prev].slice(0, 8));
        };

        /**
         * Subscribe to whale transaction alerts.
         *
         * Socket.IO buffers the subscription until the connection is available, so firing
         * immediately ensures we never miss the first connect event. Re-adding the
         * listener on connect lets reconnections restore the room membership.
         *
         * Subscribes to the 'large-transfer' room which receives all whale transactions
         * above the configured threshold.
         */
        const subscribeToWhaleTransactions = () => {
            websocket.subscribe('large-transfer');
            console.log('📡 Subscribed to large-transfer room');
        };

        // Room events ARE prefixed (prevents global namespace collisions)
        // Use helper method - automatically prefixes to 'whale-alerts:large-transfer'
        websocket.on('large-transfer', handleNewWhaleTransaction);

        // Use helper method for connection events
        websocket.onConnect(subscribeToWhaleTransactions);
        console.log('📡 Listening for large-transfer events');

        // Fire once immediately; the client buffers it until the connection is live.
        subscribeToWhaleTransactions();

        return () => {
            // Clean up using helper methods
            websocket.off('large-transfer', handleNewWhaleTransaction);
            websocket.offConnect(subscribeToWhaleTransactions);
        };
    }, [websocket]);

    /**
     * Refresh the whale activity time series for a selected day range.
     *
     * Fetches aggregated transfer volume, reshapes the payload for the chart, and
     * handles loading/error state so the UI can communicate progress. This keeps the
     * chart responsive when operators explore different time windows.
     *
     * @param range - Number of days to request from the backend time-series endpoint
     * @returns Promise that resolves once data is loaded and state is updated
     */
    const refreshSeries = async (range: number) => {
        setLoading(true);
        setError(null);
        try {
            const data = await api.get('/plugins/whale-alerts/timeseries', { days: range });
            // Map API response to include 'value' field required by LineChart
            const transformedSeries = (data.series || []).map((point: any) => ({
                ...point,
                value: point.volume || 0
            }));
            setSeries(transformedSeries);
        } catch (fetchError) {
            console.error(fetchError);
            setError(fetchError instanceof Error ? fetchError.message : 'Unable to load timeseries');
        } finally {
            setLoading(false);
        }
    };

    /**
     * Aggregate summary metrics for the stats cards.
     *
     * Calculating totals and peaks on the fly keeps the cards consistent with the
     * currently rendered time series without requiring duplicated server responses.
     */
    const summary = useMemo(() => {
        if (!series.length) {
            return {
                total: 0,
                average: 0,
                peak: 0,
                activity: 0
            };
        }
        const total = series.reduce((acc, point) => acc + point.value, 0);
        const peak = Math.max(...series.map(point => point.max ?? point.value));
        const activity = series.reduce((acc, point) => acc + (point.count ?? 0), 0);
        return {
            total,
            average: total / series.length,
            peak,
            activity
        };
    }, [series]);

    /**
     * Respond to user-driven range selection changes.
     *
     * Prevents redundant network calls when clicking the active range, updates the
     * selected state for UI feedback, and then hydrates the chart by invoking
     * `refreshSeries`.
     *
     * @param range - The new time range (in days) chosen by the user
     * @returns Promise that resolves once the series fetch completes
     */
    const onRangeChange = async (range: number) => {
        if (range === selectedRange) {
            return;
        }
        setSelectedRange(range);
        await refreshSeries(range);
    };

    return (
        <div className="whale-dashboard">
            <ui.Card>
                <div className="stack">
                    <header className="whale-dashboard__header">
                        <div className="whale-dashboard__title-group">
                            <h2 className="whale-dashboard__title">Whale capital flows</h2>
                            <p className="whale-dashboard__subtitle">Aggregated TRX volume from transfers above the whale threshold.</p>
                        </div>
                        <div className="segmented-control whale-range-selector">
                            {RANGE_OPTIONS.map(range => (
                                <button
                                    key={range}
                                    type="button"
                                    className={range === selectedRange ? 'is-active' : ''}
                                    onClick={() => onRangeChange(range)}
                                    disabled={loading}
                                >
                                    {range}d
                                </button>
                            ))}
                        </div>
                    </header>

                    <section className="whale-stats-grid">
                        <ui.Card tone="muted" padding="sm">
                            <div className="whale-stat-card">
                                <div className="whale-stat-card__label">Total volume</div>
                                <div className="whale-stat-card__value">{formatAmount(summary.total)} TRX</div>
                                <div className="whale-stat-card__delta">Across {series.length} days</div>
                            </div>
                        </ui.Card>
                        <ui.Card tone="muted" padding="sm">
                            <div className="whale-stat-card">
                                <div className="whale-stat-card__label">Daily average</div>
                                <div className="whale-stat-card__value">{formatAmount(summary.average)} TRX</div>
                                <div className="whale-stat-card__delta">Whale inflow per day</div>
                            </div>
                        </ui.Card>
                        <ui.Card tone="muted" padding="sm">
                            <div className="whale-stat-card">
                                <div className="whale-stat-card__label">Largest move</div>
                                <div className="whale-stat-card__value">{formatAmount(summary.peak)} TRX</div>
                                <div className="whale-stat-card__delta">Peak transaction amount</div>
                            </div>
                        </ui.Card>
                        <ui.Card tone="muted" padding="sm">
                            <div className="whale-stat-card">
                                <div className="whale-stat-card__label">Transactions</div>
                                <div className="whale-stat-card__value">{formatAmount(summary.activity)}</div>
                                <div className="whale-stat-card__delta">High-value transfers processed</div>
                            </div>
                        </ui.Card>
                    </section>

                    <div className="whale-chart-container">
                        {loading && !series.length ? (
                            <ui.Skeleton style={{ height: '240px' }} />
                        ) : (
                            <charts.LineChart
                                series={[
                                    {
                                        id: 'whales-volume',
                                        label: 'TRX moved',
                                        data: series,
                                        color: '#7C9BFF'
                                    }
                                ]}
                                yAxisFormatter={(value: number) => `${Math.round(value).toLocaleString()}`}
                                emptyLabel="No whale transactions recorded during this range."
                            />
                        )}
                    </div>

                    {error && <p className="whale-error">{error}</p>}
                </div>
            </ui.Card>

            <ui.Card>
                <div className="whale-highlights">
                    <header className="whale-highlights__header">
                        <div className="whale-dashboard__title-group">
                            <h3 className="whale-highlights__title">Latest whale transfers</h3>
                            <p className="whale-dashboard__subtitle">Sorted by most recent activity.</p>
                        </div>
                        <ui.Badge tone="neutral" className="whale-highlights__count">{highlights.length} events</ui.Badge>
                    </header>
                    <div className="whale-highlights__list">
                        {highlights.map(item => (
                            <article key={item.txId} className="whale-highlight-item">
                                <div className="whale-highlight-item__header">
                                    <strong className="whale-highlight-item__amount">{formatAmount(item.amountTRX)} TRX</strong>
                                    <span className="whale-highlight-item__timestamp">{new Date(item.timestamp).toLocaleString()}</span>
                                </div>
                                <div className="whale-highlight-item__addresses">
                                    {item.fromAddress} → {item.toAddress}
                                </div>
                                {item.memo && <p className="whale-highlight-item__memo">{item.memo}</p>}
                            </article>
                        ))}
                        {!highlights.length && <p className="whale-highlights__empty">No whale movements recorded yet.</p>}
                    </div>
                </div>
            </ui.Card>
        </div>
    );
}
