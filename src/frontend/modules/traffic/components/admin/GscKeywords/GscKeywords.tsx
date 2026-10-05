'use client';

/**
 * Admin panel surfacing the Google Search Console keyword cache.
 *
 * The daily `gsc:fetch` job has stored keyword/clicks/impressions/CTR/
 * position rows in Mongo since the GSC integration shipped, but until this
 * panel the only admin surface was the credentials form. This panel renders:
 *
 * - **Clicks / impressions trend** — two line charts side by side from the
 *   daily buckets (separate charts because impressions dwarf clicks by orders
 *   of magnitude and would flatten a shared axis).
 * - **Top pages table** — the landing pages search surfaced over a selectable
 *   window, backed by the [page, date] totals. Because that request omits the
 *   `query` dimension it escapes GSC's query anonymization, so it accounts for
 *   clicks that no keyword row can (the anonymized low-volume queries), and
 *   including impressions surfaces pages Google showed even with zero clicks.
 * - **Keyword → page pairs table** — which page each keyword surfaced, uncapped
 *   so it accounts for every keyword→page combination in the window. Aggregates
 *   the raw query cache by the `{query, page}` couple, so it inherits GSC's
 *   query anonymization and will not fully reconcile with the top-pages totals.
 *
 * Chart totals come from the backend's date-only GSC totals (immune to
 * query anonymization); the pairs table is limited to non-anonymized queries
 * by the GSC API itself. The header surfaces the fetch status (configured /
 * last fetch) so a stalled `gsc:fetch` job is visible, and the window picker
 * shows the actual dates covered.
 *
 * Google delivers each day several days late. The backend ends every picker
 * window on the newest day Google has delivered, and this panel formats days
 * in UTC so the labels match the calendar day Google reported.
 * Mirrors the TrafficDashboard pattern: client-only, session-cookie auth,
 * fetch-on-mount, per-panel loading/error state.
 */

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { LineChart } from '../../../../../features/charts/components/LineChart';
import type { ChartSeries } from '../../../../../features/charts/components/LineChart';
import { Panel } from '../../../../../components/ui/Panel';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../components/ui/Table';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { SegmentedControl } from '../../../../../components/ui/SegmentedControl';
import { adminGetGscPages, adminGetGscKeywordPages, adminGetGscKeywordsByDay, adminGetGscStatus } from '../../../api';
import type { IGscPage, IGscKeywordPage, IGscDailyKeywords, IGscStatus } from '../../../api';
import { TabToolbar } from '../TabToolbar';
import { PanelBody } from '../PanelBody';
import styles from './GscKeywords.module.scss';

/** Selectable lookback window ids, which double as the button labels. */
type GscWindowId = '24h' | '7d' | '30d';

/**
 * Keyword-table lookback windows. 30d is the backend's hard ceiling. The id is
 * what the picker selects and `hours` is what the API takes, so the id stays a
 * stable string `<SegmentedControl>` can key on while the request shape is
 * derived from it.
 */
const PERIOD_OPTIONS: ReadonlyArray<{ id: GscWindowId; label: string; hours: number }> = [
    { id: '24h', label: '24h', hours: 24 },
    { id: '7d', label: '7d', hours: 168 },
    { id: '30d', label: '30d', hours: 720 }
];

/** Days of daily buckets for the trend charts. */
const TREND_DAYS = 30;

/**
 * Format a GSC calendar day for display.
 *
 * Google reports search data per calendar day, and the backend stores each
 * day as midnight UTC. Formatting in the browser's own time zone turns
 * midnight UTC on 9/30 into the evening of 9/29 for anyone west of UTC, so
 * every label would read one day early. Pinning the formatter to UTC shows
 * the day Google actually reported. Calling it during render is safe here
 * because this panel fetches on mount and only formats data that arrived in
 * the browser, so the server never renders a date to mismatch against.
 *
 * @param value - A day as a Date or ISO string; the charts pass a Date and
 *   the coverage label passes the backend's window bounds.
 * @returns The day as a localized date string, such as "9/30/2026".
 */
function formatGscDay(value: Date | string): string {
    return new Date(value).toLocaleDateString(undefined, { timeZone: 'UTC' });
}

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
 * Google Search Console keyword dashboard — clicks/impressions trend plus the
 * top-pages and (uncapped) keyword→page pairs tables.
 */
export function GscKeywords() {
    const [windowId, setWindowId] = useState<GscWindowId>('24h');

    // The picker owns the window id; every fetch below wants hours, so resolve
    // once per render rather than threading two pieces of state that can drift.
    const periodHours = (PERIOD_OPTIONS.find(option => option.id === windowId) ?? PERIOD_OPTIONS[0]).hours;

    const [pages, setPages] = useState<IGscPage[] | null>(null);
    const [pagesError, setPagesError] = useState<string | null>(null);
    const [pagesLoading, setPagesLoading] = useState(true);

    const [pairs, setPairs] = useState<IGscKeywordPage[] | null>(null);
    const [pairsWindow, setPairsWindow] = useState<{ start: string; end: string } | null>(null);
    const [pairsError, setPairsError] = useState<string | null>(null);
    const [pairsLoading, setPairsLoading] = useState(true);

    const [daily, setDaily] = useState<IGscDailyKeywords[] | null>(null);
    const [dailyError, setDailyError] = useState<string | null>(null);
    const [dailyLoading, setDailyLoading] = useState(true);

    const [status, setStatus] = useState<IGscStatus | null>(null);

    // Top-pages fetch — re-runs when the window changes, keyed to the same
    // picker as the keyword table. Backed by the anonymization-immune page
    // totals, so it accounts for clicks the keyword table cannot.
    useEffect(() => {
        let active = true;
        setPagesLoading(true);
        setPagesError(null);

        adminGetGscPages({ periodHours, limit: 25 })
            .then(data => { if (active) setPages(data.pages); })
            .catch(err => { if (active) setPagesError(err instanceof Error ? err.message : 'Failed to load'); })
            .finally(() => { if (active) setPagesLoading(false); });

        return () => { active = false; };
    }, [periodHours]);

    // Keyword→page pairs fetch — re-runs when the window changes, keyed to the
    // same picker as the pages table. Reads the raw query cache, so it carries
    // GSC's query anonymization. Uncapped: returns every pair, so it fully
    // accounts for which page each keyword surfaced. Also carries the covered
    // window that drives the header's coverage label.
    useEffect(() => {
        let active = true;
        setPairsLoading(true);
        setPairsError(null);

        adminGetGscKeywordPages({ periodHours })
            .then(data => {
                if (active) {
                    setPairs(data.pairs);
                    setPairsWindow(data.windowStart && data.windowEnd
                        ? { start: data.windowStart, end: data.windowEnd }
                        : null);
                }
            })
            .catch(err => { if (active) setPairsError(err instanceof Error ? err.message : 'Failed to load'); })
            .finally(() => { if (active) setPairsLoading(false); });

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

    // Status fetch — surfaces configured/last-fetch so a stalled gsc:fetch
    // job is distinguishable from genuinely-zero clicks. Best-effort: a
    // status failure must not block the data panels.
    useEffect(() => {
        let active = true;

        adminGetGscStatus()
            .then(data => { if (active) setStatus(data); })
            .catch(() => { /* status line simply stays hidden */ });

        return () => { active = false; };
    }, []);

    // Memoize only the data mapping; colors resolve on every render so a
    // theme switch re-resolves instead of serving stale memoized values.
    const clicksSeriesData = useMemo(
        () => (daily ?? []).map(b => ({ date: b.date, value: b.totalClicks })),
        [daily]
    );

    const impressionsSeriesData = useMemo(
        () => (daily ?? []).map(b => ({ date: b.date, value: b.totalImpressions })),
        [daily]
    );

    const clicksSeries: ChartSeries[] = clicksSeriesData.length > 0 ? [{
        id: 'clicks',
        label: 'Clicks',
        color: resolveCSSColor('--color-primary', '#4b8cff'),
        data: clicksSeriesData
    }] : [];

    const impressionsSeries: ChartSeries[] = impressionsSeriesData.length > 0 ? [{
        id: 'impressions',
        label: 'Impressions',
        color: resolveCSSColor('--color-success', '#57d48c'),
        data: impressionsSeriesData
    }] : [];

    const numberFormatter = useMemo(() => new Intl.NumberFormat(), []);

    // Fetch health and the window actually covered, stated once in the toolbar.
    // A warning replaces the freshness line, because a stalled or unconfigured
    // fetch is the one fact that changes how every figure below should be read.
    let statusLine: ReactNode = null;
    if (status && !status.configured) {
        statusLine = (
            <span className={styles.meta_warning}>
                <AlertTriangle size={14} aria-hidden="true" />
                Search Console is not configured, so no data is being fetched.
            </span>
        );
    } else if (status?.configured && !status.lastFetch) {
        statusLine = (
            <span className={styles.meta_warning}>
                <AlertTriangle size={14} aria-hidden="true" />
                The daily gsc:fetch job has not stored data yet.
            </span>
        );
    } else if (status?.configured && status.lastFetch) {
        statusLine = <>Fetched <ClientTime date={status.lastFetch} format="relative" /></>;
    }
    const coverage = pairsWindow
        ? `covers ${formatGscDay(pairsWindow.start)} – ${formatGscDay(pairsWindow.end)}`
        : null;

    return (
        <section className={styles.container}>
            <TabToolbar
                title="Search keywords"
                meta={(
                    <>
                        {statusLine}
                        {statusLine && coverage ? ', ' : null}
                        {coverage}
                    </>
                )}
                actions={(
                    <SegmentedControl
                        label="Lookback window"
                        value={windowId}
                        options={PERIOD_OPTIONS}
                        onChange={setWindowId}
                    />
                )}
                aboutSummary="Where this data comes from"
                about={(
                    <>
                        <p>
                            Google Search Console queries that surfaced this site, refreshed daily by
                            the <code>gsc:fetch</code> job. Google delivers each day several days late,
                            so every window ends on the newest day Google has delivered.
                        </p>
                        <p>
                            Keyword rows exclude queries Google anonymizes, so the charts and the top
                            pages table use totals fetched without the query dimension, and the
                            keyword-to-page pairs will not fully reconcile with them. Configure
                            credentials in the Settings tab.
                        </p>
                    </>
                )}
            />

            <div className={styles.band}>
                <Panel title="Clicks" titleAs="h3" meta={`Last ${TREND_DAYS} days`}>
                    <PanelBody loading={dailyLoading} error={dailyError}>
                        <LineChart
                            series={clicksSeries}
                            height={180}
                            xAxisFormatter={formatGscDay}
                            yAxisFormatter={(v) => numberFormatter.format(v)}
                            emptyLabel="No GSC data yet — configure credentials in Settings."
                        />
                    </PanelBody>
                </Panel>

                <Panel title="Impressions" titleAs="h3" meta={`Last ${TREND_DAYS} days`}>
                    <PanelBody loading={dailyLoading} error={dailyError}>
                        <LineChart
                            series={impressionsSeries}
                            height={180}
                            xAxisFormatter={formatGscDay}
                            yAxisFormatter={(v) => numberFormatter.format(v)}
                            emptyLabel="No GSC data yet — configure credentials in Settings."
                        />
                    </PanelBody>
                </Panel>
            </div>

            <div className={`${styles.band} ${styles.band__wide}`}>
                <Panel
                    title="Top pages"
                    titleAs="h3"
                    meta={(
                        <span title="Page totals fetched without the query dimension, so they escape Google's query anonymization and include pages shown with zero clicks.">
                            All clicks, including anonymized queries
                        </span>
                    )}
                >
                    <PanelBody
                        loading={pagesLoading}
                        error={pagesError}
                        empty={!pages || pages.length === 0}
                        emptyMessage="No page data in this window yet. Trigger a refresh in the Settings tab to backfill the current window."
                    >
                        <Table variant="compact" flush className={styles.dense_table}>
                            <Thead>
                                <Tr>
                                    <Th scope="col" width="expand">Page</Th>
                                    <Th scope="col" width="shrink" numeric>Clicks</Th>
                                    <Th scope="col" width="shrink" numeric>Impr.</Th>
                                    <Th scope="col" width="shrink" numeric>CTR</Th>
                                    <Th scope="col" width="shrink" numeric>Pos.</Th>
                                </Tr>
                            </Thead>
                            <Tbody>
                                {(pages ?? []).map(pg => (
                                    <Tr key={pg.page}>
                                        <Td className={styles.wrap_cell}>{pg.page}</Td>
                                        <Td numeric>{numberFormatter.format(pg.clicks)}</Td>
                                        <Td numeric muted>{numberFormatter.format(pg.impressions)}</Td>
                                        <Td numeric muted>{(pg.ctr * 100).toFixed(1)}%</Td>
                                        <Td numeric muted>{pg.position.toFixed(1)}</Td>
                                    </Tr>
                                ))}
                            </Tbody>
                        </Table>
                    </PanelBody>
                </Panel>

                <Panel
                    title="Keyword → page pairs"
                    titleAs="h3"
                    meta={(
                        <span title="Every keyword→page combination in the window, uncapped. Drawn from the raw query cache, so it carries Google's low-volume-query anonymization; clicks here won't fully reconcile with the top pages totals.">
                            Every pair, anonymized queries excluded
                        </span>
                    )}
                >
                    <PanelBody
                        loading={pairsLoading}
                        error={pairsError}
                        empty={!pairs || pairs.length === 0}
                        emptyMessage="No keyword→page pairs in this window. Google omits anonymized low-volume queries, so a quiet window can be empty even when top pages shows clicks."
                    >
                        <Table variant="compact" flush stickyHeader className={styles.dense_table}>
                            <Thead>
                                <Tr>
                                    <Th scope="col">Keyword</Th>
                                    <Th scope="col">Page</Th>
                                    <Th scope="col" width="shrink" numeric>Clicks</Th>
                                    <Th scope="col" width="shrink" numeric>Impr.</Th>
                                    <Th scope="col" width="shrink" numeric>CTR</Th>
                                    <Th scope="col" width="shrink" numeric>Pos.</Th>
                                </Tr>
                            </Thead>
                            <Tbody>
                                {(pairs ?? []).map(pair => (
                                    <Tr key={`${pair.keyword} ${pair.page}`}>
                                        <Td className={styles.wrap_cell}>{pair.keyword}</Td>
                                        <Td className={styles.wrap_cell} muted>{pair.page}</Td>
                                        <Td numeric>{numberFormatter.format(pair.clicks)}</Td>
                                        <Td numeric muted>{numberFormatter.format(pair.impressions)}</Td>
                                        <Td numeric muted>{(pair.ctr * 100).toFixed(1)}%</Td>
                                        <Td numeric muted>{pair.position.toFixed(1)}</Td>
                                    </Tr>
                                ))}
                            </Tbody>
                        </Table>
                    </PanelBody>
                </Panel>
            </div>
        </section>
    );
}
