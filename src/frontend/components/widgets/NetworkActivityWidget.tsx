/**
 * @fileoverview Core "network activity" overview widget renderer.
 *
 * Renders the hourly TRON network-activity chart as a placeable core widget,
 * styled after the plugin chart widgets (resource-tracker, dust-tracker) but
 * owned by core because it reads core-owned block/transaction data. The
 * `core:network-activity` backend fetcher ships the combined series — each
 * bucket carries the transaction count, native-transfer count, and native TRX
 * transfer volume — so the metric toggle re-slices the already-fetched points
 * client-side (no refetch); only the window toggle refetches.
 *
 * SSR + Live Updates: the SSR payload seeds `useState`, so the chart paints
 * immediately with real data (no loading flash). Liveness reuses the global
 * `block:new` pipeline via Redux `state.blockchain.latestBlock` — the same
 * signal the core block-ticker rides — throttled so the active window refetches
 * at most once a minute as new blocks land. `context.websocket` is not used for
 * this: it auto-prefixes event names with the owner id and so cannot subscribe
 * to the un-prefixed global `block:new` event.
 *
 * Metric auto-rotation: when the operator enables `rotate` in the placement
 * config, the widget advances the metric on a timer (default 30s, bounded
 * 10–300s) so an unattended chart cycles transactions → transfers → volume. The
 * advance pauses while the tab is hidden and stops permanently the moment the
 * visitor clicks a metric, honouring explicit interaction over the timer.
 *
 * @module frontend/components/widgets/NetworkActivityWidget
 */

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IWidgetComponentProps } from '@/types';
import { useAppSelector } from '../../store/hooks';
import styles from './NetworkActivityWidget.module.scss';

/**
 * Operator-selectable time window. Mirrors the backend window union and the
 * sibling chart widgets' 1h/24h/7d controls.
 */
type ActivityWindow = '1h' | '24h' | '7d';

/** Toggle-able metric — which value each bucket contributes to the chart. */
type ActivityMetric = 'transactions' | 'transfers' | 'volume';

/**
 * One bucket of the overview series, mirroring the backend
 * `IOverviewTimeseriesPoint`. Declared locally (rather than imported) so the
 * widget owns its render shape, matching the sibling widgets' convention.
 */
interface NetworkActivityPoint {
    date: string;
    transactions: number;
    transfers: number;
    volume: number;
}

/** SSR payload shape produced by the `core:network-activity` data fetcher. */
interface NetworkActivityData {
    window?: ActivityWindow;
    points?: NetworkActivityPoint[];
}

/** Operator-editable per-placement config this widget reads. */
interface NetworkActivityConfig {
    title?: string;
    defaultWindow?: ActivityWindow;
    display?: 'normal' | 'widget';
    rotate?: boolean;
    rotateSeconds?: number;
}

/** Window toggle options, in display order. */
const WINDOWS: ReadonlyArray<{ id: ActivityWindow; label: string }> = [
    { id: '1h', label: '1h' },
    { id: '24h', label: '24h' },
    { id: '7d', label: '7d' }
];

/**
 * Metric toggle options. `kind` drives axis formatting (`count` → integers,
 * `trx` → compact TRX); `color` references the themed chart palette so series
 * color stays theme-aware.
 */
const METRICS: ReadonlyArray<{ id: ActivityMetric; label: string; color: string; kind: 'count' | 'trx' }> = [
    { id: 'transactions', label: 'Transactions', color: 'var(--chart-color-1)', kind: 'count' },
    { id: 'transfers', label: 'Transfers', color: 'var(--chart-color-1)', kind: 'count' },
    { id: 'volume', label: 'Volume (TRX)', color: 'var(--chart-color-3)', kind: 'trx' }
];

/** Minimum gap between block-driven live refetches of the active window. */
const LIVE_REFRESH_THROTTLE_MS = 60_000;

/** Rotation cadence, in seconds, when config enables rotation without a value. */
const DEFAULT_ROTATE_SECONDS = 30;
/** Lower/upper rotation bounds mirroring the config schema, clamped defensively. */
const MIN_ROTATE_SECONDS = 10;
const MAX_ROTATE_SECONDS = 300;

/**
 * Format a large count/volume into a compact K/M/B string for the Y-axis.
 *
 * Why: TRX transfer volume reaches millions and dense count axes overflow with
 * full thousands separators, so abbreviate above 1,000 while keeping small
 * values exact and readable.
 *
 * @param value - Raw numeric value for the axis tick or bar.
 * @returns A compact label (e.g. "1.2M", "3.4K", "950").
 */
function formatCompact(value: number): string {
    const abs = Math.abs(value);
    let result: string;
    if (abs >= 1_000_000_000) {
        result = `${(value / 1_000_000_000).toFixed(1)}B`;
    } else if (abs >= 1_000_000) {
        result = `${(value / 1_000_000).toFixed(1)}M`;
    } else if (abs >= 1_000) {
        result = `${(value / 1_000).toFixed(1)}K`;
    } else {
        result = Math.round(value).toLocaleString();
    }
    return result;
}

/**
 * Build a hydration-safe relative X-axis label (e.g. "-6h", "-30m", "now").
 *
 * Why: absolute clock labels differ between the UTC server and the local client
 * and break hydration. Measuring elapsed time against the latest bucket — a
 * value that comes from the SSR data, identical on both sides — keeps the axis
 * deterministic across the hydration boundary.
 *
 * @param dateMs - The bucket's epoch-ms (from the data).
 * @param refMs - The latest bucket's epoch-ms used as the "now" reference.
 * @returns A short relative label anchored to the latest bucket.
 */
function elapsedLabel(dateMs: number, refMs: number): string {
    const diffMin = Math.round((refMs - dateMs) / 60_000);
    let result: string;
    if (diffMin <= 0) {
        result = 'now';
    } else if (diffMin < 60) {
        result = `-${diffMin}m`;
    } else {
        const diffHr = Math.round(diffMin / 60);
        result = diffHr < 48 ? `-${diffHr}h` : `-${Math.round(diffHr / 24)}d`;
    }
    return result;
}

/**
 * Network-activity overview chart widget.
 *
 * @param props - Widget component props. Consumes the SSR `data` payload, the
 *   `context` (chart components + API client), and the operator `instanceConfig`.
 * @returns The bar chart with metric/window toggles, or an empty state until
 *   the first blocks are indexed.
 */
export function NetworkActivityWidget({ data, context, instanceConfig }: IWidgetComponentProps) {
    const { charts, api } = context;
    const BarChart = charts.BarChart;

    const config = (instanceConfig ?? {}) as NetworkActivityConfig;
    const chartMode = config.display === 'widget' ? 'widget' : 'normal';

    const initial = data as NetworkActivityData | undefined;
    const [points, setPoints] = useState<NetworkActivityPoint[]>(initial?.points ?? []);
    const [activeWindow, setActiveWindow] = useState<ActivityWindow>(
        config.defaultWindow ?? initial?.window ?? '7d'
    );
    const [metric, setMetric] = useState<ActivityMetric>('transactions');
    const [refreshing, setRefreshing] = useState(false);
    // Set true the first time the visitor clicks a metric, permanently stopping
    // auto-rotation for the session (until reload). An explicit pick outranks the
    // timer — the operator's "rotate until touched" intent.
    const [userPinned, setUserPinned] = useState(false);

    // Ref mirror of the active window so the block-driven live effect always
    // refetches the visible window without re-subscribing on every toggle, and
    // so out-of-order responses for a stale window can be dropped.
    const windowRef = useRef(activeWindow);
    // Timestamp of the last refetch, gating the live throttle. Seeded to mount
    // time (not 0) so the SSR-seeded points survive the first throttle window
    // instead of being overwritten by a redundant heavy refetch on the first
    // block after mount. Mutated by both the live effect and manual window
    // changes so a manual fetch resets the throttle window.
    const lastRefreshRef = useRef(Date.now());

    const activeMetric = METRICS.find(item => item.id === metric) ?? METRICS[0];

    /**
     * Fetch the overview series for a window from the core blockchain API.
     * Returns an empty array on any failure so callers can decide whether to
     * keep existing data.
     *
     * @param target - Window to fetch.
     * @returns The fetched buckets, or an empty array on error.
     */
    const fetchSeries = useCallback(async (target: ActivityWindow): Promise<NetworkActivityPoint[]> => {
        const response = await api.get<{ data?: NetworkActivityPoint[] }>(
            '/blockchain/overview/timeseries',
            { window: target }
        );
        return response?.data ?? [];
    }, [api]);

    /**
     * Switch the visible window and refetch its series. Guards against
     * redundant work (same window) and out-of-order responses (a slow earlier
     * window resolving after a newer selection).
     *
     * @param next - Window the operator selected.
     */
    const handleWindow = useCallback(async (next: ActivityWindow) => {
        if (next === windowRef.current) {
            return;
        }
        setActiveWindow(next);
        windowRef.current = next;
        lastRefreshRef.current = Date.now();
        setRefreshing(true);
        try {
            const fetched = await fetchSeries(next);
            if (windowRef.current === next) {
                setPoints(fetched);
            }
        } catch {
            // Keep existing data on failure.
        } finally {
            if (windowRef.current === next) {
                setRefreshing(false);
            }
        }
    }, [fetchSeries]);

    // Live updates: refetch the active window as new blocks arrive, throttled.
    // Redux `latestBlock` is fed by the global `block:new` handler in
    // SocketBridge, so this stays current without per-widget socket wiring.
    const latestBlockNumber = useAppSelector(state => state.blockchain.latestBlock?.blockNumber ?? null);
    useEffect(() => {
        if (latestBlockNumber === null) {
            return;
        }
        const now = Date.now();
        if (now - lastRefreshRef.current < LIVE_REFRESH_THROTTLE_MS) {
            return;
        }
        lastRefreshRef.current = now;
        const active = windowRef.current;
        let cancelled = false;
        fetchSeries(active)
            .then(fetched => {
                if (!cancelled && windowRef.current === active) {
                    setPoints(fetched);
                }
            })
            .catch(() => {
                // Keep existing data on a failed live refresh.
            });
        return () => {
            cancelled = true;
        };
    }, [latestBlockNumber, fetchSeries]);

    // Resolved rotation cadence, clamped to the schema bounds so a hand-edited
    // placement can't set an absurd interval that slips past server validation.
    // `instanceConfig` is an unchecked cast, so a non-finite value (a string, an
    // object, a BSON NaN from a DB edit) would survive `??` and clamp to NaN —
    // and `setInterval(NaN)` coerces to 0, a hot loop that pegs the UI thread. The
    // finite fallback closes that path before the numeric clamp.
    const rotateEnabled = config.rotate === true;
    const requestedRotateSeconds = Number(config.rotateSeconds ?? DEFAULT_ROTATE_SECONDS);
    const safeRotateSeconds = Number.isFinite(requestedRotateSeconds) ? requestedRotateSeconds : DEFAULT_ROTATE_SECONDS;
    const rotateIntervalMs = Math.min(
        MAX_ROTATE_SECONDS,
        Math.max(MIN_ROTATE_SECONDS, safeRotateSeconds)
    ) * 1000;

    // Auto-rotate the metric on a timer when the operator enabled rotation and the
    // visitor hasn't taken manual control. The advance is skipped while the tab is
    // hidden (no point cycling an unseen chart) and the effect tears down its timer
    // once `userPinned` flips, so a click stops rotation for the session. The
    // functional update reads METRICS in display order without listing `metric` as
    // a dependency, keeping the timer stable across metric changes.
    useEffect(() => {
        if (!rotateEnabled || userPinned) {
            return;
        }
        const timer = setInterval(() => {
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
                return;
            }
            setMetric(current => {
                const index = METRICS.findIndex(item => item.id === current);
                return METRICS[(index + 1) % METRICS.length].id;
            });
        }, rotateIntervalMs);
        return () => clearInterval(timer);
    }, [rotateEnabled, userPinned, rotateIntervalMs]);

    // Single series for the selected metric. The toggle re-slices the same
    // points rather than refetching, mirroring the resource widget.
    const series = useMemo(() => [{
        id: metric,
        label: activeMetric.label,
        color: activeMetric.color,
        data: points.map(point => ({ date: point.date, value: point[metric] }))
    }], [points, metric, activeMetric]);

    // Latest bucket time, used as the relative-axis reference. Derived from
    // data (not the clock) so the X-axis is hydration-stable.
    const latestBucketMs = useMemo(() => {
        if (points.length === 0) {
            return null;
        }
        const parsed = Date.parse(points[points.length - 1].date);
        return Number.isNaN(parsed) ? null : parsed;
    }, [points]);

    /**
     * Format a Y-axis value for the active metric — compact TRX for volume,
     * integer counts otherwise.
     *
     * @param value - Raw tick/bar value.
     * @returns The formatted axis label.
     */
    const formatValue = useCallback((value: number): string => {
        return activeMetric.kind === 'trx' ? formatCompact(value) : Math.round(value).toLocaleString();
    }, [activeMetric]);

    /**
     * Format an X-axis tick relative to the latest bucket (hydration-safe).
     *
     * @param date - The tick's Date (data-derived).
     * @returns A short relative label, or empty string before data loads.
     */
    const formatAxisDate = useCallback((date: Date): string => {
        return latestBucketMs === null ? '' : elapsedLabel(date.getTime(), latestBucketMs);
    }, [latestBucketMs]);

    // Metric and window toggles, placed in the chart's header `actions` slot so
    // they share the title row instead of stacking a toolbar above the chart.
    const controls = (
        <>
            <div className="segmented-control" role="group" aria-label="Metric">
                {METRICS.map(item => (
                    <button
                        key={item.id}
                        type="button"
                        className={metric === item.id ? 'is-active' : undefined}
                        onClick={() => { setMetric(item.id); setUserPinned(true); }}
                        aria-pressed={metric === item.id}
                    >
                        {item.label}
                    </button>
                ))}
            </div>
            <div className="segmented-control" role="group" aria-label="Time window">
                {WINDOWS.map(option => (
                    <button
                        key={option.id}
                        type="button"
                        className={activeWindow === option.id ? 'is-active' : undefined}
                        onClick={() => handleWindow(option.id)}
                        aria-pressed={activeWindow === option.id}
                    >
                        {option.label}
                    </button>
                ))}
            </div>
        </>
    );

    return (
        <div className={styles.widget}>
            {points.length === 0 ? (
                <>
                    <div className={styles.controls}>{controls}</div>
                    <p className={styles.empty}>No network activity yet.</p>
                </>
            ) : (
                <div
                    className={`${styles.chart_container} ${refreshing ? styles.refreshing : ''}`}
                    aria-busy={refreshing}
                >
                    <BarChart
                        mode={chartMode}
                        series={series}
                        title={config.title}
                        actions={controls}
                        height={chartMode === 'normal' ? 280 : 120}
                        yAxisFormatter={formatValue}
                        xAxisFormatter={formatAxisDate}
                        showLegend={false}
                    />
                </div>
            )}
        </div>
    );
}
