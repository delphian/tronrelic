'use client';

/**
 * Admin panel for redirect-hit analytics on the `/system/traffic` Redirects tab.
 *
 * A served admin-managed redirect used to leave no trace: the edge middleware
 * issues the 301/302 and returns before any analytics beacon runs. This panel
 * surfaces the `redirect_events` rows now captured by that beacon so an operator
 * can answer the questions that decide whether a rule earns its keep — which
 * legacy URLs are still hit, which get zero traffic (safe to remove), and
 * whether that traffic is humans or bots.
 *
 * Self-contained by design. The Redirects tab is deliberately ungoverned by the
 * page's global period picker and bot toggle (those govern the visitor-centric
 * Analytics/Visitors tabs), so this panel owns its own window and humans-only
 * controls — mirroring how `CrawlerDashboard` owns its `sinceHours` windows.
 * Client-only, session-cookie auth, fetch-on-mount: SSR + Live Updates does not
 * apply because the hosting page is admin-gated and client-only.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CornerUpRight, ListOrdered } from 'lucide-react';
import { LineChart } from '../../../../../features/charts/components/LineChart';
import type { ChartSeries } from '../../../../../features/charts/components/LineChart';
import { Card } from '../../../../../components/ui/Card';
import { adminGetRedirectAnalytics } from '../../../api';
import type { AnalyticsPeriod, IRedirectAnalytics } from '../../../api';
import styles from './RedirectAnalytics.module.scss';

/** Lookback windows offered by the panel's own picker. */
const PERIOD_OPTIONS: ReadonlyArray<{ label: string; value: AnalyticsPeriod }> = [
    { label: '24h', value: '24h' },
    { label: '7d', value: '7d' },
    { label: '30d', value: '30d' },
    { label: '90d', value: '90d' }
];

/**
 * Resolve a CSS variable to its computed value with an SSR-safe fallback. The
 * chart line takes its color from the data-visualization palette — series
 * identity is data semantics, not brand theming, so a literal fallback is the
 * documented exception.
 *
 * @param varName - CSS variable name (e.g. '--chart-color-1').
 * @param fallback - Hex fallback when the document is unavailable.
 * @returns The resolved color string.
 */
function resolveCSSColor(varName: string, fallback: string): string {
    if (typeof document === 'undefined') {
        return fallback;
    }
    const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return value || fallback;
}

/**
 * Redirect-hit analytics dashboard: a headline total with a human/bot split, a
 * hits-over-time trend, and a per-pattern breakdown of which rules are hit.
 *
 * @returns The redirect analytics panel.
 */
export function RedirectAnalytics() {
    const [period, setPeriod] = useState<AnalyticsPeriod>('7d');
    // Humans-only by default, matching the page's global bot-filter default —
    // bots hammer legacy URLs, so the honest "is anyone real still hitting this"
    // read excludes them.
    const [humansOnly, setHumansOnly] = useState(true);

    const [data, setData] = useState<IRedirectAnalytics | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    // A request-id ref supersedes stale in-flight responses so a slower earlier
    // request cannot overwrite a faster later one when controls change quickly.
    const reqId = useRef(0);
    /**
     * Load the analytics for the current window + bot filter, discarding the
     * result if a newer request has since started (the request-id guard).
     *
     * @returns Resolves once state has been updated (or the response discarded).
     */
    const fetchAnalytics = useCallback(async (): Promise<void> => {
        const id = ++reqId.current;
        setLoading(true);
        setError(null);
        try {
            const result = await adminGetRedirectAnalytics(period, undefined, humansOnly);
            if (id === reqId.current) {
                setData(result);
            }
        } catch (err) {
            if (id === reqId.current) {
                setError(err instanceof Error ? err.message : 'Failed to load');
            }
        } finally {
            if (id === reqId.current) {
                setLoading(false);
            }
        }
    }, [period, humansOnly]);

    useEffect(() => { fetchAnalytics(); }, [fetchAnalytics]);

    const numberFormatter = useMemo(() => new Intl.NumberFormat(), []);

    /**
     * Build the single hits-over-time chart series from the fetched buckets.
     * Color resolution stays outside this memo so a theme switch re-resolves on
     * the next render rather than serving a stale memoized color.
     *
     * @returns One ChartSeries, or an empty array when there is nothing to plot.
     */
    const series: ChartSeries[] = useMemo(() => {
        if (!data || data.series.length === 0) {
            return [];
        }
        return [{
            id: 'redirects',
            label: 'Redirects served',
            fill: true,
            data: data.series.map(p => ({ date: p.bucket, value: p.hits }))
        }];
    }, [data]);
    const coloredSeries: ChartSeries[] = series.map(s => ({ ...s, color: resolveCSSColor('--chart-color-1', '#3b82f6') }));

    const hasHits = data !== null && data.total > 0;

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <div>
                    <h2 className={styles.title}>Redirect analytics</h2>
                    <p className={styles.subtitle}>
                        How often each admin-managed redirect is served. A rule
                        with steady hits is earning its keep; one with zero hits
                        over a long window is a candidate for removal. Bots hammer
                        stale legacy URLs, so the default view excludes them.
                    </p>
                </div>
                <div className={styles.controls}>
                    <div className={styles.window_picker} role="group" aria-label="Lookback window">
                        {PERIOD_OPTIONS.map(opt => (
                            <button
                                key={opt.value}
                                type="button"
                                onClick={() => setPeriod(opt.value)}
                                className={opt.value === period ? styles.window_active : styles.window_button}
                                aria-pressed={opt.value === period}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                    <div className={styles.bot_toggle} role="group" aria-label="Bot traffic filter">
                        <button
                            type="button"
                            className={humansOnly ? styles.bot_active : styles.bot_button}
                            onClick={() => setHumansOnly(true)}
                            aria-pressed={humansOnly}
                            title="Count only redirects served to human-classified requests."
                        >
                            Humans only
                        </button>
                        <button
                            type="button"
                            className={!humansOnly ? styles.bot_active : styles.bot_button}
                            onClick={() => setHumansOnly(false)}
                            aria-pressed={!humansOnly}
                            title="Also count redirects served to classified bots and crawlers."
                        >
                            Include bots
                        </button>
                    </div>
                </div>
            </header>

            <Card padding="md" className={styles.panel}>
                <div className={styles.panel_header}>
                    <CornerUpRight size={18} aria-hidden="true" />
                    <h3 className={styles.panel_title}>Redirects served</h3>
                </div>
                {error ? (
                    <p className={styles.panel_error}>{error}</p>
                ) : loading && data === null ? (
                    <p className={styles.panel_loading}>Loading…</p>
                ) : (
                    <>
                        <div className={styles.summary}>
                            <span className={styles.summary_total}>{numberFormatter.format(data?.total ?? 0)}</span>
                            <span className={styles.summary_split}>
                                {numberFormatter.format(data?.humanTotal ?? 0)} human · {numberFormatter.format(data?.botTotal ?? 0)} bot
                            </span>
                        </div>
                        <LineChart
                            series={coloredSeries}
                            height={260}
                            yAxisMin={0}
                            showLegend={false}
                            yAxisFormatter={(v) => numberFormatter.format(v)}
                            emptyLabel="No redirects served in this window."
                        />
                    </>
                )}
            </Card>

            <Card padding="md" className={styles.panel}>
                <div className={styles.panel_header}>
                    <ListOrdered size={18} aria-hidden="true" />
                    <h3 className={styles.panel_title}>By redirect rule</h3>
                </div>
                {error ? (
                    <p className={styles.panel_error}>{error}</p>
                ) : loading && data === null ? (
                    <p className={styles.panel_loading}>Loading…</p>
                ) : !hasHits || !data || data.byPattern.length === 0 ? (
                    <p className={styles.panel_empty}>No redirects served in this window.</p>
                ) : (
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th scope="col">Source</th>
                                <th scope="col">Destination</th>
                                <th scope="col" className={styles.center_col}>Code</th>
                                <th scope="col" className={styles.numeric_col}>Hits</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.byPattern.map(row => (
                                <tr key={row.pattern}>
                                    <td><code className={styles.code}>{row.pattern}</code></td>
                                    <td><code className={styles.code}>{row.destination}</code></td>
                                    <td className={styles.center}>{row.permanent ? '301' : '302'}</td>
                                    <td className={styles.numeric}>{numberFormatter.format(row.hits)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </Card>
        </div>
    );
}
