'use client';

/**
 * Admin panel for crawler and AI-bot visibility.
 *
 * Surfaces the SEO/AI-standing signals already captured by the bot
 * classifier at `traffic_events` write time:
 *
 * - **Crawler trend** — daily event counts per `bot_class` rendered as a
 *   multi-series line chart. Answers "is AI-crawler traffic growing, and
 *   how does it compare to search-engine crawling and human traffic?"
 * - **Per-bot-class paths** — which paths a selected bot class actually
 *   fetches. Defaults to `ai_crawler` because "are AI crawlers reaching
 *   our content pages or bouncing off the homepage" is the core
 *   AI-standing question.
 *
 * Mirrors the TrafficDashboard pattern: client-only, session-cookie auth,
 * fetch-on-mount, per-panel loading/error state. SSR + Live Updates does
 * not apply — the hosting `/system/traffic` page is admin-gated and
 * client-only.
 */

import { useEffect, useMemo, useState } from 'react';
import { Bot, Route } from 'lucide-react';
import { LineChart } from '../../../../../features/charts/components/LineChart';
import type { ChartSeries } from '../../../../../features/charts/components/LineChart';
import { Card } from '../../../../../components/ui/Card';
import { adminGetBotTrend, adminGetBotPaths } from '../../../api';
import type { IBotClassDailyPoint, ITrafficBucket } from '../../../api';
import styles from './CrawlerDashboard.module.scss';

/** Lookback windows offered. 30d is the backend's hard ceiling. */
const SINCE_OPTIONS: Array<{ label: string; hours: number }> = [
    { label: '24h', hours: 24 },
    { label: '7d', hours: 168 },
    { label: '30d', hours: 720 }
];

/**
 * Bot classes in display order, with chart palette assignments and labels.
 * Colors come from the data-visualization palette (`--chart-color-*`) —
 * series identity is data semantics, not brand theming, so literal
 * fallbacks are the documented exception.
 */
const BOT_CLASS_SERIES: Array<{ key: string; label: string; cssVar: string; fallback: string }> = [
    { key: 'human', label: 'Human', cssVar: '--chart-color-1', fallback: '#3b82f6' },
    { key: 'search_engine', label: 'Search engine', cssVar: '--chart-color-2', fallback: '#22c55e' },
    { key: 'ai_crawler', label: 'AI crawler', cssVar: '--chart-color-5', fallback: '#8b5cf6' },
    { key: 'social_unfurler', label: 'Social unfurler', cssVar: '--chart-color-3', fallback: '#f59e0b' },
    { key: 'uptime_probe', label: 'Uptime probe', cssVar: '--chart-color-6', fallback: '#06b6d4' },
    { key: 'bot_other', label: 'Other bots', cssVar: '--chart-color-8', fallback: '#f97316' },
    { key: 'unclassified', label: 'Unclassified', cssVar: '--chart-color-9', fallback: '#14b8a6' }
];

/** Bot classes selectable in the per-path panel (excludes the NULL fold). */
const PATH_BOT_CLASSES: Array<{ key: string; label: string }> = [
    { key: 'ai_crawler', label: 'AI crawler' },
    { key: 'search_engine', label: 'Search engine' },
    { key: 'social_unfurler', label: 'Social unfurler' },
    { key: 'uptime_probe', label: 'Uptime probe' },
    { key: 'bot_other', label: 'Other bots' },
    { key: 'human', label: 'Human' }
];

/**
 * Resolve a CSS variable to its computed value with an SSR-safe fallback.
 *
 * @param varName - CSS variable name (e.g. '--chart-color-1')
 * @param fallback - Hex fallback when document is unavailable
 * @returns Resolved color string
 */
function resolveCSSColor(varName: string, fallback: string): string {
    if (typeof document === 'undefined') return fallback;
    const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return value || fallback;
}

/**
 * Crawler visibility dashboard — bot-class trend chart plus the top paths
 * fetched by a selected bot class.
 */
export function CrawlerDashboard() {
    const [sinceHours, setSinceHours] = useState<number>(168);
    const [pathBotClass, setPathBotClass] = useState<string>('ai_crawler');

    const [trend, setTrend] = useState<IBotClassDailyPoint[] | null>(null);
    const [trendError, setTrendError] = useState<string | null>(null);
    const [trendLoading, setTrendLoading] = useState(true);
    const [clickhouseEnabled, setClickhouseEnabled] = useState(true);

    const [paths, setPaths] = useState<ITrafficBucket[] | null>(null);
    const [pathsError, setPathsError] = useState<string | null>(null);
    const [pathsLoading, setPathsLoading] = useState(true);

    // Trend fetch — re-runs when the window changes. Cleanup flag guards
    // against a slower earlier response landing after a faster later one.
    useEffect(() => {
        let active = true;
        setTrendLoading(true);
        setTrendError(null);

        adminGetBotTrend(sinceHours)
            .then(data => {
                if (active) {
                    setTrend(data.points);
                    setClickhouseEnabled(data.clickhouseEnabled);
                }
            })
            .catch(err => { if (active) setTrendError(err instanceof Error ? err.message : 'Failed to load'); })
            .finally(() => { if (active) setTrendLoading(false); });

        return () => { active = false; };
    }, [sinceHours]);

    // Paths fetch — re-runs when the window or selected bot class changes.
    useEffect(() => {
        let active = true;
        setPathsLoading(true);
        setPathsError(null);

        adminGetBotPaths(pathBotClass, { sinceHours, limit: 15 })
            .then(data => { if (active) setPaths(data.buckets); })
            .catch(err => { if (active) setPathsError(err instanceof Error ? err.message : 'Failed to load'); })
            .finally(() => { if (active) setPathsLoading(false); });

        return () => { active = false; };
    }, [pathBotClass, sinceHours]);

    // Build one chart series per bot class that has at least one event in
    // the window — all-zero series only add legend noise.
    const trendSeries: ChartSeries[] = useMemo(() => {
        if (!trend || trend.length === 0) return [];
        return BOT_CLASS_SERIES
            .map(cls => ({
                id: cls.key,
                label: cls.label,
                color: resolveCSSColor(cls.cssVar, cls.fallback),
                fill: false,
                data: trend.map(p => ({ date: p.day, value: p.counts[cls.key] ?? 0 }))
            }))
            .filter(series => series.data.some(d => d.value > 0));
    }, [trend]);

    const numberFormatter = useMemo(() => new Intl.NumberFormat(), []);

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <div>
                    <h2 className={styles.title}>Crawlers</h2>
                    <p className={styles.subtitle}>
                        Daily crawler pressure per <code>bot_class</code> and the
                        paths each class actually fetches. AI crawlers (GPTBot,
                        ClaudeBot, PerplexityBot, …) reaching content pages is
                        the signal that AI-search standing is improving.
                    </p>
                </div>
                <div className={styles.window_picker} role="group" aria-label="Lookback window">
                    {SINCE_OPTIONS.map(opt => (
                        <button
                            key={opt.hours}
                            type="button"
                            onClick={() => setSinceHours(opt.hours)}
                            className={opt.hours === sinceHours ? styles.window_active : styles.window_button}
                            aria-pressed={opt.hours === sinceHours}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
            </header>

            {!clickhouseEnabled && (
                <Card padding="md" className={styles.notice_card}>
                    <p>
                        ClickHouse is not configured on this deployment.
                        Traffic events are not being recorded; crawler panels
                        will report zero rows.
                    </p>
                </Card>
            )}

            <Card padding="md" className={styles.panel}>
                <div className={styles.panel_header}>
                    <Bot size={18} aria-hidden="true" />
                    <h3 className={styles.panel_title}>Crawler trend</h3>
                </div>
                {trendError ? (
                    <p className={styles.panel_error}>{trendError}</p>
                ) : trendLoading ? (
                    <p className={styles.panel_loading}>Loading…</p>
                ) : (
                    <LineChart
                        series={trendSeries}
                        height={280}
                        yAxisFormatter={(v) => numberFormatter.format(v)}
                        emptyLabel="No events in this window."
                    />
                )}
            </Card>

            <Card padding="md" className={styles.panel}>
                <div className={styles.panel_header}>
                    <Route size={18} aria-hidden="true" />
                    <h3 className={styles.panel_title}>Paths fetched by bot class</h3>
                    <label className={styles.class_select_label}>
                        <span className="text-muted">Class</span>
                        <select
                            className={styles.class_select}
                            value={pathBotClass}
                            onChange={e => setPathBotClass(e.target.value)}
                            aria-label="Bot class"
                        >
                            {PATH_BOT_CLASSES.map(cls => (
                                <option key={cls.key} value={cls.key}>{cls.label}</option>
                            ))}
                        </select>
                    </label>
                </div>
                {pathsError ? (
                    <p className={styles.panel_error}>{pathsError}</p>
                ) : pathsLoading ? (
                    <p className={styles.panel_loading}>Loading…</p>
                ) : !paths || paths.length === 0 ? (
                    <p className={styles.panel_empty}>No events for this class in this window.</p>
                ) : (
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th scope="col">path</th>
                                <th scope="col" className={styles.numeric_col}>events</th>
                            </tr>
                        </thead>
                        <tbody>
                            {paths.map((b, i) => (
                                <tr key={`${b.key ?? 'null'}_${i}`}>
                                    <td><code className={styles.code}>{b.key ?? '(null)'}</code></td>
                                    <td className={styles.numeric}>{numberFormatter.format(b.count)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </Card>
        </div>
    );
}
