'use client';

/**
 * Admin panel surfacing the site's Google Search Console history.
 *
 * The daily `gsc:fetch` job stores keyword/clicks/impressions/CTR/position
 * rows in a permanent ClickHouse archive, so the window picker reaches back
 * to the first archived day ("All"). This panel renders:
 *
 * - **Clicks / impressions trend** — two line charts side by side, following
 *   the picker but never shorter than 30 days, bucketed by day, week, or
 *   month as the backend chooses for the window's length (separate charts
 *   because impressions dwarf clicks by orders of magnitude and would flatten
 *   a shared axis).
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
 * in UTC so the labels match the calendar day Google reported. The newest
 * days are often fresh data Google has not finalized, so their figures can
 * still change. The toolbar and each chart say from which day the figures
 * are not final, and the chart tooltip marks each such day.
 * Mirrors the TrafficDashboard pattern: client-only, session-cookie auth,
 * fetch-on-mount, per-panel loading/error state.
 */

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { LineChart } from '../../../../../features/charts/components/LineChart';
import type { ChartSeries } from '../../../../../features/charts/components/LineChart';
import { Panel } from '../../../../../components/ui/Panel';
import { Badge } from '../../../../../components/ui/Badge';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../components/ui/Table';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { SegmentedControl } from '../../../../../components/ui/SegmentedControl';
import { adminGetGscPages, adminGetGscKeywordPages, adminGetGscKeywordTrend, adminGetGscStatus } from '../../../api';
import type { IGscPage, IGscKeywordPage, IGscTrendResult, IGscStatus, IGscWindowParams, GscGranularity } from '../../../api';
import { TabToolbar } from '../TabToolbar';
import { PanelBody } from '../PanelBody';
import styles from './GscKeywords.module.scss';

/** Selectable lookback window ids, which double as the button labels. */
type GscWindowId = '24h' | '7d' | '30d' | '90d' | '1y' | 'all';

/**
 * The trend window used for the picker's short options. A one-day or one-week
 * chart is too short to read as a trend, so those options keep 30 days.
 */
const MIN_TREND_WINDOW: IGscWindowParams = { periodHours: 720 };

/**
 * Lookback windows. The archive keeps every fetched day, so "All" reaches
 * back to the first one. The id is what the picker selects; `window` is what
 * the tables request and `trendWindow` what the charts request, so the id
 * stays a stable string `<SegmentedControl>` can key on while the request
 * shapes are derived from it. `trendLabel` describes the charts' span.
 */
const PERIOD_OPTIONS: ReadonlyArray<{
    id: GscWindowId;
    label: string;
    window: IGscWindowParams;
    trendWindow: IGscWindowParams;
    trendLabel: string;
}> = [
    { id: '24h', label: '24h', window: { periodHours: 24 }, trendWindow: MIN_TREND_WINDOW, trendLabel: 'Last 30 days' },
    { id: '7d', label: '7d', window: { periodHours: 168 }, trendWindow: MIN_TREND_WINDOW, trendLabel: 'Last 30 days' },
    { id: '30d', label: '30d', window: { periodHours: 720 }, trendWindow: MIN_TREND_WINDOW, trendLabel: 'Last 30 days' },
    { id: '90d', label: '90d', window: { periodHours: 2160 }, trendWindow: { periodHours: 2160 }, trendLabel: 'Last 90 days' },
    { id: '1y', label: '1y', window: { periodHours: 8760 }, trendWindow: { periodHours: 8760 }, trendLabel: 'Last year' },
    { id: 'all', label: 'All', window: { period: 'all' }, trendWindow: { period: 'all' }, trendLabel: 'All history' }
];

/** How each bucket size is described next to the trend's span. */
const GRANULARITY_LABELS: Readonly<Record<GscGranularity, string>> = {
    day: 'by day',
    week: 'by week',
    month: 'by month'
};

/**
 * Label a trend bucket by its first day. A month reads as "Mar 2025" rather
 * than as its first day, and a week as "Week of …", so a reader does not take
 * a bucket's figures for a single day's.
 *
 * @param value - The bucket's first day.
 * @param granularity - The trend's bucket size.
 * @returns The label for an axis tick or tooltip.
 */
function formatBucket(value: Date | string, granularity: GscGranularity): string {
    let label = formatGscDay(value);
    if (granularity === 'month') {
        label = new Date(value).toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short', year: 'numeric' });
    } else if (granularity === 'week') {
        label = `Week of ${label}`;
    }
    return label;
}

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
 */
function formatGscDay(value: Date | string): string {
    return new Date(value).toLocaleDateString(undefined, { timeZone: 'UTC' });
}

/**
 * Mark the day from which Google's figures are not final yet.
 *
 * Google returns the newest days before it has finished collecting them, so
 * their clicks and impressions usually rise over the following days. Without
 * a marker, a low figure on a recent day reads as a real drop in traffic.
 *
 * @param firstIncompleteDate - The first non-final day (`YYYY-MM-DD`) the
 *   backend reported for the data being labelled.
 * @returns A small warning badge naming that day.
 */
function NotFinalBadge({ firstIncompleteDate }: { firstIncompleteDate: string }) {
    return (
        <Badge
            tone="warning"
            size="xs"
            title="Google has not finalized these days yet, so their figures can still change."
        >
            Not final from {formatGscDay(firstIncompleteDate)}
        </Badge>
    );
}

/** Resolve a CSS variable (such as '--color-primary') to its computed value with an SSR-safe fallback. */
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

    // The picker owns the window id; every fetch below wants a request shape,
    // so resolve once per render rather than threading two pieces of state
    // that can drift. The option objects are module constants, so their
    // identity is stable and safe as effect dependencies.
    const selected = PERIOD_OPTIONS.find(option => option.id === windowId) ?? PERIOD_OPTIONS[0];
    const tableWindow = selected.window;
    const trendWindow = selected.trendWindow;

    const [pages, setPages] = useState<IGscPage[] | null>(null);
    const [pagesError, setPagesError] = useState<string | null>(null);
    const [pagesLoading, setPagesLoading] = useState(true);

    const [pairs, setPairs] = useState<IGscKeywordPage[] | null>(null);
    const [pairsWindow, setPairsWindow] = useState<{ start: string; end: string; firstIncompleteDate: string | null } | null>(null);
    const [pairsError, setPairsError] = useState<string | null>(null);
    const [pairsLoading, setPairsLoading] = useState(true);

    const [trend, setTrend] = useState<IGscTrendResult | null>(null);
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

        adminGetGscPages({ ...tableWindow, limit: 25 })
            .then(data => { if (active) setPages(data.pages); })
            .catch(err => { if (active) setPagesError(err instanceof Error ? err.message : 'Failed to load'); })
            .finally(() => { if (active) setPagesLoading(false); });

        return () => { active = false; };
    }, [tableWindow]);

    // Keyword→page pairs fetch — re-runs when the window changes, keyed to the
    // same picker as the pages table. Reads the raw query cache, so it carries
    // GSC's query anonymization. Uncapped: returns every pair, so it fully
    // accounts for which page each keyword surfaced. Also carries the covered
    // window that drives the header's coverage label.
    useEffect(() => {
        let active = true;
        setPairsLoading(true);
        setPairsError(null);

        adminGetGscKeywordPages(tableWindow)
            .then(data => {
                if (active) {
                    setPairs(data.pairs);
                    setPairsWindow(data.windowStart && data.windowEnd
                        ? { start: data.windowStart, end: data.windowEnd, firstIncompleteDate: data.firstIncompleteDate }
                        : null);
                }
            })
            .catch(err => { if (active) setPairsError(err instanceof Error ? err.message : 'Failed to load'); })
            .finally(() => { if (active) setPairsLoading(false); });

        return () => { active = false; };
    }, [tableWindow]);

    // Trend fetch — re-runs when the trend window changes. The short picker
    // options share one 30-day trend window, so switching among them does
    // not refetch the charts. The backend picks day, week, or month buckets
    // for the window's length and reports which it used.
    useEffect(() => {
        let active = true;
        setDailyLoading(true);
        setDailyError(null);

        adminGetGscKeywordTrend(trendWindow)
            .then(data => { if (active) setTrend(data); })
            .catch(err => { if (active) setDailyError(err instanceof Error ? err.message : 'Failed to load'); })
            .finally(() => { if (active) setDailyLoading(false); });

        return () => { active = false; };
    }, [trendWindow]);

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
    const buckets = trend?.buckets;
    const granularity: GscGranularity = trend?.granularity ?? 'day';

    const clicksSeriesData = useMemo(
        () => (buckets ?? []).map(b => ({ date: b.date, value: b.totalClicks })),
        [buckets]
    );

    const impressionsSeriesData = useMemo(
        () => (buckets ?? []).map(b => ({ date: b.date, value: b.totalImpressions })),
        [buckets]
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

    // Buckets holding a day Google had not finalized at the last fetch, keyed
    // the way the chart hands dates to its tooltip formatter (midnight UTC, as
    // YYYY-MM-DD).
    const preliminaryDays = useMemo(
        () => new Set((buckets ?? []).filter(b => b.preliminary).map(b => b.date)),
        [buckets]
    );
    const trendFirstIncompleteDate = (buckets ?? []).find(b => b.preliminary)?.date ?? null;

    /**
     * Label a bucket on the chart's axis, by its first day or its month.
     *
     * @param date - The bucket's first day, as midnight UTC.
     */
    const formatAxisBucket = (date: Date): string => formatBucket(date, granularity);

    /**
     * Label a bucket in the chart tooltip, flagging buckets whose figures are
     * not final so a hover on a low recent point does not read as a real drop.
     *
     * @param date - The hovered bucket's first day, as midnight UTC.
     */
    const formatTooltipBucket = (date: Date): string => {
        const label = formatBucket(date, granularity);
        return preliminaryDays.has(date.toISOString().split('T')[0]) ? `${label} (not final)` : label;
    };

    const trendMeta = (
        <>
            {`${selected.trendLabel}, ${GRANULARITY_LABELS[granularity]}`}
            {trendFirstIncompleteDate ? ' ' : null}
            {trendFirstIncompleteDate ? <NotFinalBadge firstIncompleteDate={trendFirstIncompleteDate} /> : null}
        </>
    );

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
        statusLine = (
            <>
                Fetched <ClientTime date={status.lastFetch} format="relative" />
                {status.history?.firstDate ? `, history from ${formatGscDay(status.history.firstDate)}` : null}
            </>
        );
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
                        {pairsWindow?.firstIncompleteDate ? ' ' : null}
                        {pairsWindow?.firstIncompleteDate
                            ? <NotFinalBadge firstIncompleteDate={pairsWindow.firstIncompleteDate} />
                            : null}
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
                            the <code>gsc:fetch</code> job and kept permanently, so &ldquo;All&rdquo; reaches
                            back to the first archived day. Google delivers each day several days late,
                            so every window ends on the newest day Google has delivered.
                        </p>
                        <p>
                            The charts never cover less than 30 days. Longer windows are grouped by week
                            (up to two years) or by month, and a week is labelled by its Monday.
                        </p>
                        <p>
                            The newest days are fresh figures Google has not finalized, and they usually
                            rise over the following days. A &ldquo;Not final&rdquo; badge marks the first such
                            day, and the chart tooltip marks each one.
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
                <Panel title="Clicks" titleAs="h3" meta={trendMeta}>
                    <PanelBody loading={dailyLoading} error={dailyError}>
                        <LineChart
                            series={clicksSeries}
                            height={180}
                            xAxisFormatter={formatAxisBucket}
                            tooltipDateFormatter={formatTooltipBucket}
                            yAxisFormatter={(v) => numberFormatter.format(v)}
                            emptyLabel="No GSC data yet — configure credentials in Settings."
                        />
                    </PanelBody>
                </Panel>

                <Panel title="Impressions" titleAs="h3" meta={trendMeta}>
                    <PanelBody loading={dailyLoading} error={dailyError}>
                        <LineChart
                            series={impressionsSeries}
                            height={180}
                            xAxisFormatter={formatAxisBucket}
                            tooltipDateFormatter={formatTooltipBucket}
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
