'use client';

/**
 * Admin panel surfacing the Google Search Console keyword cache.
 *
 * The daily `gsc:fetch` job has stored keyword/clicks/impressions/CTR/
 * position rows in Mongo since the GSC integration shipped, but until this
 * panel the only admin surface was the credentials form. This panel renders:
 *
 * - **Clicks / impressions trend** — two stacked line charts from the daily
 *   buckets (separate charts because impressions dwarf clicks by orders of
 *   magnitude and would flatten a shared axis).
 * - **Top keywords table** — clicks, impressions, CTR, and average position
 *   per query over a selectable window.
 *
 * Data is delayed ~3 days by GSC's ingestion lag (handled server-side).
 * Mirrors the TrafficDashboard pattern: client-only, session-cookie auth,
 * fetch-on-mount, per-panel loading/error state.
 */

import { useEffect, useMemo, useState } from 'react';
import { Search, TrendingUp } from 'lucide-react';
import { LineChart } from '../../../../../features/charts/components/LineChart';
import type { ChartSeries } from '../../../../../features/charts/components/LineChart';
import { Card } from '../../../../../components/ui/Card';
import { adminGetGscKeywords, adminGetGscKeywordsByDay } from '../../../api';
import type { IGscKeyword, IGscDailyKeywords } from '../../../api';
import styles from './GscKeywords.module.scss';

/** Keyword-table lookback windows. 30d is the backend's hard ceiling. */
const PERIOD_OPTIONS: Array<{ label: string; hours: number }> = [
    { label: '24h', hours: 24 },
    { label: '7d', hours: 168 },
    { label: '30d', hours: 720 }
];

/** Days of daily buckets for the trend charts. */
const TREND_DAYS = 30;

/**
 * Resolve a CSS variable to its computed value with an SSR-safe fallback.
 *
 * @param varName - CSS variable name (e.g. '--color-primary')
 * @param fallback - Hex fallback when document is unavailable
 * @returns Resolved color string
 */
function resolveCSSColor(varName: string, fallback: string): string {
    if (typeof document === 'undefined') return fallback;
    const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return value || fallback;
}

/**
 * Google Search Console keyword dashboard — clicks/impressions trend plus
 * the top-keywords table.
 */
export function GscKeywords() {
    const [periodHours, setPeriodHours] = useState<number>(168);

    const [keywords, setKeywords] = useState<IGscKeyword[] | null>(null);
    const [keywordsError, setKeywordsError] = useState<string | null>(null);
    const [keywordsLoading, setKeywordsLoading] = useState(true);

    const [daily, setDaily] = useState<IGscDailyKeywords[] | null>(null);
    const [dailyError, setDailyError] = useState<string | null>(null);
    const [dailyLoading, setDailyLoading] = useState(true);

    // Keyword table fetch — re-runs when the window changes.
    useEffect(() => {
        let active = true;
        setKeywordsLoading(true);
        setKeywordsError(null);

        adminGetGscKeywords({ periodHours, limit: 25 })
            .then(data => { if (active) setKeywords(data); })
            .catch(err => { if (active) setKeywordsError(err instanceof Error ? err.message : 'Failed to load'); })
            .finally(() => { if (active) setKeywordsLoading(false); });

        return () => { active = false; };
    }, [periodHours]);

    // Trend fetch — fixed window, fetched once on mount.
    useEffect(() => {
        let active = true;

        adminGetGscKeywordsByDay(TREND_DAYS)
            .then(data => { if (active) setDaily(data); })
            .catch(err => { if (active) setDailyError(err instanceof Error ? err.message : 'Failed to load'); })
            .finally(() => { if (active) setDailyLoading(false); });

        return () => { active = false; };
    }, []);

    const clicksSeries: ChartSeries[] = useMemo(() => {
        if (!daily || daily.length === 0) return [];
        return [{
            id: 'clicks',
            label: 'Clicks',
            color: resolveCSSColor('--color-primary', '#4b8cff'),
            data: daily.map(b => ({ date: b.date, value: b.totalClicks }))
        }];
    }, [daily]);

    const impressionsSeries: ChartSeries[] = useMemo(() => {
        if (!daily || daily.length === 0) return [];
        return [{
            id: 'impressions',
            label: 'Impressions',
            color: resolveCSSColor('--color-success', '#57d48c'),
            data: daily.map(b => ({ date: b.date, value: b.totalImpressions }))
        }];
    }, [daily]);

    const numberFormatter = useMemo(() => new Intl.NumberFormat(), []);

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <div>
                    <h2 className={styles.title}>Search keywords</h2>
                    <p className={styles.subtitle}>
                        Google Search Console queries that surfaced this site,
                        refreshed daily by the <code>gsc:fetch</code> job. GSC
                        delays its data ~3 days; windows are shifted to match.
                        Configure credentials in the Settings tab.
                    </p>
                </div>
                <div className={styles.window_picker} role="group" aria-label="Lookback window">
                    {PERIOD_OPTIONS.map(opt => (
                        <button
                            key={opt.hours}
                            type="button"
                            onClick={() => setPeriodHours(opt.hours)}
                            className={opt.hours === periodHours ? styles.window_active : styles.window_button}
                            aria-pressed={opt.hours === periodHours}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
            </header>

            <div className={styles.grid_two}>
                <Card padding="md" className={styles.panel}>
                    <div className={styles.panel_header}>
                        <TrendingUp size={18} aria-hidden="true" />
                        <h3 className={styles.panel_title}>Clicks — {TREND_DAYS}d</h3>
                    </div>
                    {dailyError ? (
                        <p className={styles.panel_error}>{dailyError}</p>
                    ) : dailyLoading ? (
                        <p className={styles.panel_loading}>Loading…</p>
                    ) : (
                        <LineChart
                            series={clicksSeries}
                            height={220}
                            yAxisFormatter={(v) => numberFormatter.format(v)}
                            emptyLabel="No GSC data yet — configure credentials in Settings."
                        />
                    )}
                </Card>

                <Card padding="md" className={styles.panel}>
                    <div className={styles.panel_header}>
                        <TrendingUp size={18} aria-hidden="true" />
                        <h3 className={styles.panel_title}>Impressions — {TREND_DAYS}d</h3>
                    </div>
                    {dailyError ? (
                        <p className={styles.panel_error}>{dailyError}</p>
                    ) : dailyLoading ? (
                        <p className={styles.panel_loading}>Loading…</p>
                    ) : (
                        <LineChart
                            series={impressionsSeries}
                            height={220}
                            yAxisFormatter={(v) => numberFormatter.format(v)}
                            emptyLabel="No GSC data yet — configure credentials in Settings."
                        />
                    )}
                </Card>
            </div>

            <Card padding="md" className={styles.panel}>
                <div className={styles.panel_header}>
                    <Search size={18} aria-hidden="true" />
                    <h3 className={styles.panel_title}>Top keywords</h3>
                </div>
                {keywordsError ? (
                    <p className={styles.panel_error}>{keywordsError}</p>
                ) : keywordsLoading ? (
                    <p className={styles.panel_loading}>Loading…</p>
                ) : !keywords || keywords.length === 0 ? (
                    <p className={styles.panel_empty}>
                        No keyword data in this window. GSC credentials may not
                        be configured (Settings tab), or the daily fetch has not
                        run yet.
                    </p>
                ) : (
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th scope="col">keyword</th>
                                <th scope="col" className={styles.numeric_col}>clicks</th>
                                <th scope="col" className={styles.numeric_col}>impressions</th>
                                <th scope="col" className={styles.numeric_col}>CTR</th>
                                <th scope="col" className={styles.numeric_col}>position</th>
                            </tr>
                        </thead>
                        <tbody>
                            {keywords.map(kw => (
                                <tr key={kw.keyword}>
                                    <td className={styles.keyword_cell}>{kw.keyword}</td>
                                    <td className={styles.numeric}>{numberFormatter.format(kw.clicks)}</td>
                                    <td className={styles.numeric}>{numberFormatter.format(kw.impressions)}</td>
                                    <td className={styles.numeric}>{(kw.ctr * 100).toFixed(1)}%</td>
                                    <td className={styles.numeric}>{kw.position.toFixed(1)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </Card>
        </div>
    );
}
