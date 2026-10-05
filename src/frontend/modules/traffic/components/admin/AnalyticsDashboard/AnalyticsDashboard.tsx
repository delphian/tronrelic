/**
 * AnalyticsDashboard Component
 *
 * Admin analytics dashboard displaying aggregate traffic insights across
 * all visitors. Surfaces actionable data for SEO optimization, campaign
 * evaluation, and conversion tracking.
 *
 * Sections:
 * 1. Overview headline — KPI strip with period deltas + unified trend chart
 * 2. Traffic sources (with per-source drill-down) beside top landing pages
 * 3. Geography beside a column of the short sections (conversion funnel,
 *    devices, accounts) and the new-vs-returning chart
 * 4. UTM campaign performance with conversion rates
 *
 * Layout follows the data-page pattern the resource-markets detail page set:
 * one `Panel` per section with the shared context in its header row, compact
 * tables that run to the panel's edges, and panels placed side by side where
 * their content is narrow, so the tab reads as a dense sheet rather than a
 * column of mostly-empty cards. Grids align panels to the top so a short panel
 * beside a tall one keeps its own height instead of stretching into an empty
 * card.
 *
 * The lookback period, custom range, and bot filter arrive as props from the
 * page-level global controls so every tab reads the same window. All table
 * primary numbers are distinct visitors, matching analytics-platform
 * convention; raw event counts remain available server-side.
 */

'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { IFigureListRow } from '@/types';
import { LineChart } from '../../../../../features/charts/components/LineChart';
import type { ChartSeries } from '../../../../../features/charts/components/LineChart';
import { Panel } from '../../../../../components/ui/Panel';
import { FigureList } from '../../../../../components/ui/FigureList';
import { Badge, type BadgeTone } from '../../../../../components/ui/Badge';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../components/ui/Table';
import { Grid, Stack } from '../../../../../components/layout';
import { OverviewTrend } from '../OverviewTrend';
import { BarList } from '../BarList';
import { ShareBar } from '../ShareBar';
import {
    adminGetTrafficSources,
    adminGetTrafficSourceDetails,
    adminGetTopLandingPages,
    adminGetGeoDistribution,
    adminGetDeviceBreakdown,
    adminGetCampaignPerformance,
    adminGetConversionFunnel,
    adminGetRetention,
    adminGetAnalyticsOverview,
} from '../../../api';
import type {
    AnalyticsPeriod,
    ICustomDateRange,
    ITrafficSource,
    ITrafficSourceDetails,
    ILandingPage,
    IGeoEntry,
    IDeviceEntry,
    ICampaignEntry,
    IFunnelStage,
    IRetentionEntry,
    IAnalyticsOverview,
} from '../../../api';
import styles from './AnalyticsDashboard.module.scss';

/** Number of table columns in the traffic sources table, so the drill-down row spans all of them. */
const SOURCE_COLUMN_COUNT = 5;

/**
 * Resolve a CSS variable to its computed hex value.
 *
 * Falls back to the provided default if the variable can't be resolved
 * (e.g., during SSR when document is unavailable).
 *
 * @param varName - CSS variable name (e.g., '--color-primary')
 * @param fallback - Hex fallback value
 * @returns Resolved hex color string
 */
function resolveCSSColor(varName: string, fallback: string): string {
    if (typeof document === 'undefined') return fallback;
    const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return value || fallback;
}

/**
 * Format seconds into a human-readable duration string.
 *
 * @param seconds - Duration in seconds
 * @returns Formatted string like "2m 30s" or "1h 15m"
 */
function formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

/**
 * Resolve the Badge tone (and, for categories with no direct tone
 * equivalent, a color-override class) for a traffic source category badge.
 *
 * Categories come from the backend's stored channel classification
 * (direct/organic/paid/social/email/ai/referral); unknown values fall
 * back to the referral tone. Five categories map onto an existing Badge
 * tone; email and ai have no matching tone, so they render on the neutral
 * tone with a small color-override class layered on top.
 *
 * @param category - Acquisition channel string
 * @returns Badge tone plus an optional className for categories without a
 *   direct Badge tone equivalent
 */
function getCategoryBadgeProps(category: string): { tone: BadgeTone; className?: string } {
    switch (category) {
        case 'direct': return { tone: 'neutral' };
        case 'organic': return { tone: 'success' };
        case 'social': return { tone: 'info' };
        case 'paid': return { tone: 'danger' };
        case 'email': return { tone: 'neutral', className: styles.category_badge_email };
        case 'ai': return { tone: 'neutral', className: styles.category_badge_ai };
        default: return { tone: 'warning' };
    }
}

interface IShareFigureProps {
    /** The row's value, drawn as the bar and printed beside it. */
    value: number;
    /** The largest value in the same table, which fills the bar. */
    max: number;
}

/**
 * A table cell's figure with its share bar in front of it.
 *
 * The three ranked tables on this tab used to spend a whole column on the bar;
 * drawing it beside the figure gives that column back to the labels and keeps
 * the number and its relative size together.
 *
 * @param props - The row's value and the table maximum.
 * @returns The bar followed by the formatted figure.
 */
function ShareFigure({ value, max }: IShareFigureProps) {
    return (
        <span className={styles.share_figure}>
            <ShareBar value={value} max={max} />
            <span>{value.toLocaleString()}</span>
        </span>
    );
}

interface ISourceDetailProps {
    /** The drill-down payload for one traffic source. */
    details: ITrafficSourceDetails;
}

/**
 * The drill-down shown under an expanded traffic source row.
 *
 * Engagement and conversion figures read as one label-and-value list rather
 * than four boxed tiles, and the breakdown lists sit in columns that flow by
 * the panel's width, so an expanded source adds a few lines instead of a
 * screen.
 *
 * @param props - The source's drill-down payload.
 * @returns The detail content for the expanded row.
 */
function SourceDetail({ details }: ISourceDetailProps) {
    // Sessions are derived server-side from the page-event stream (30-minute
    // inactivity rule), so these are real values; a zero means no interactive
    // page views from this cohort in the window.
    const figures: IFigureListRow[] = [
        {
            key: 'sessions',
            label: <span title="Derived sessions per visitor (30-minute inactivity rule over page events)">Avg sessions</span>,
            value: String(details.engagement.avgSessions)
        },
        { key: 'pages', label: 'Avg pages', value: String(details.engagement.avgPageViews) },
        {
            key: 'duration',
            label: <span title="Average derived-session duration (last hit minus first hit; single-page sessions count as 0s)">Avg duration</span>,
            value: formatDuration(details.engagement.avgDuration)
        },
        {
            key: 'logged-in',
            label: <span title="Visitors from this source who were logged in at any point during the window (includes returning account holders)">Logged-in rate</span>,
            value: `${details.conversion.conversionRate}%`
        }
    ];

    return (
        <div className={styles.detail}>
            <FigureList rows={figures} label="Source engagement" />

            <div className={styles.detail_columns}>
                {details.landingPages.length > 0 && (
                    <DetailList
                        title="Landing pages"
                        items={details.landingPages.map(lp => ({ key: lp.path, label: lp.path, value: `${lp.count} (${lp.percentage}%)` }))}
                    />
                )}
                {details.countries.length > 0 && (
                    <DetailList
                        title="Countries"
                        items={details.countries.map(c => ({ key: c.country, label: c.country, value: `${c.count} (${c.percentage}%)` }))}
                    />
                )}
                {details.devices.length > 0 && (
                    <DetailList
                        title="Devices"
                        items={details.devices.map(d => ({ key: d.device, label: d.device, value: `${d.count} (${d.percentage}%)` }))}
                    />
                )}
                {details.utmCampaigns.length > 0 && (
                    <DetailList
                        title="UTM campaigns"
                        items={details.utmCampaigns.map(utm => ({
                            key: `${utm.source}|${utm.medium}|${utm.campaign}`,
                            label: `${utm.source} / ${utm.medium} / ${utm.campaign}`,
                            value: String(utm.count)
                        }))}
                    />
                )}
                {!(details.gscKeywords && details.gscKeywords.length > 0) && details.searchKeywords.length > 0 && (
                    <DetailList
                        title="Search keywords"
                        items={details.searchKeywords.map(kw => ({ key: kw.keyword, label: kw.keyword, value: String(kw.count) }))}
                    />
                )}
            </div>

            {/* Search Console keywords, when the integration has data for this source. */}
            {details.gscKeywords && details.gscKeywords.length > 0 && (
                <section className={styles.detail_section}>
                    <h4 className={styles.sub_title}>
                        Search keywords
                        <Badge tone="info" size="xs">Search Console</Badge>
                    </h4>
                    <div className={styles.plain_table}>
                        <Table variant="compact" className={styles.dense_table}>
                            <Thead>
                                <Tr>
                                    <Th scope="col" width="expand">Keyword</Th>
                                    <Th scope="col" width="shrink" numeric>Clicks</Th>
                                    <Th scope="col" width="shrink" numeric>Impr.</Th>
                                    <Th scope="col" width="shrink" numeric>CTR</Th>
                                    <Th scope="col" width="shrink" numeric>Pos.</Th>
                                </Tr>
                            </Thead>
                            <Tbody>
                                {details.gscKeywords.map(kw => (
                                    <Tr key={kw.keyword}>
                                        <Td className={styles.truncate} title={kw.keyword}>{kw.keyword}</Td>
                                        <Td numeric>{kw.clicks.toLocaleString()}</Td>
                                        <Td numeric muted>{kw.impressions.toLocaleString()}</Td>
                                        <Td numeric muted>{(kw.ctr * 100).toFixed(1)}%</Td>
                                        <Td numeric muted>{kw.position.toFixed(1)}</Td>
                                    </Tr>
                                ))}
                            </Tbody>
                        </Table>
                    </div>
                </section>
            )}
        </div>
    );
}

interface IDetailListProps {
    /** Heading over the list. */
    title: string;
    /** Label and value pairs, in display order. */
    items: Array<{ key: string; label: string; value: string }>;
}

/**
 * One titled breakdown inside the source drill-down, such as its countries.
 *
 * @param props - The list heading and its rows.
 * @returns The titled list.
 */
function DetailList({ title, items }: IDetailListProps) {
    return (
        <section className={styles.detail_section}>
            <h4 className={styles.sub_title}>{title}</h4>
            <ul className={styles.detail_list}>
                {items.map(item => (
                    <li key={item.key} className={styles.detail_list__item}>
                        <span className={styles.detail_list__label} title={item.label}>{item.label}</span>
                        <span className={styles.detail_list__value}>{item.value}</span>
                    </li>
                ))}
            </ul>
        </section>
    );
}

interface IAnalyticsDashboardProps {
    /** Selected lookback period from the page-level controls. */
    period: AnalyticsPeriod;
    /** Custom date range when `period === 'custom'`. */
    customRange?: ICustomDateRange;
    /** Whether classified bot rows are included. */
    includeBots: boolean;
    /**
     * Page-level auto-refresh signal. Each increment triggers a background
     * refetch that swaps data in place — no loading blank and no collapse of an
     * open traffic-source drill-down, unlike a control-driven (foreground)
     * reload. Omitted disables periodic refresh.
     */
    refreshSignal?: number;
}

/**
 * Aggregate analytics dashboard for admin traffic insights.
 *
 * Fetches data from multiple analytics endpoints and renders the overview
 * headline, conversion funnel, traffic sources, landing pages, geography,
 * devices, campaigns, and retention data for the globally selected window.
 *
 * @param props - Global period, custom range, and bot-filter selection, plus
 *   the shared auto-refresh signal that drives periodic in-place reloads.
 */
export function AnalyticsDashboard({ period, customRange, includeBots, refreshSignal }: IAnalyticsDashboardProps) {
    const [loading, setLoading] = useState(true);

    // Data state
    const [overview, setOverview] = useState<IAnalyticsOverview | null>(null);
    const [funnel, setFunnel] = useState<IFunnelStage[]>([]);
    const [trafficSources, setTrafficSources] = useState<ITrafficSource[]>([]);
    const [trafficTotal, setTrafficTotal] = useState(0);
    const [landingPages, setLandingPages] = useState<ILandingPage[]>([]);
    const [geoData, setGeoData] = useState<IGeoEntry[]>([]);
    const [devices, setDevices] = useState<IDeviceEntry[]>([]);
    const [campaigns, setCampaigns] = useState<ICampaignEntry[]>([]);
    const [retention, setRetention] = useState<IRetentionEntry[]>([]);

    // Traffic source drill-down state
    const [expandedSource, setExpandedSource] = useState<string | null>(null);
    const [sourceDetails, setSourceDetails] = useState<Record<string, ITrafficSourceDetails>>({});
    const [sourceDetailsLoading, setSourceDetailsLoading] = useState<string | null>(null);

    const excludeBots = !includeBots;

    /**
     * Toggle drill-down for a traffic source row.
     *
     * Fetches details on first expand, then caches for subsequent toggles.
     * Collapses if the same source is clicked again.
     *
     * @param source - Referrer domain or 'direct'
     */
    const toggleSourceDetails = useCallback(async (source: string) => {
        if (expandedSource === source) {
            setExpandedSource(null);
            return;
        }
        setExpandedSource(source);
        if (!sourceDetails[source]) {
            setSourceDetailsLoading(source);
            try {
                const details = await adminGetTrafficSourceDetails(source, period, customRange, excludeBots);
                setSourceDetails(prev => ({ ...prev, [source]: details }));
            } catch (error) {
                console.error('Failed to fetch source details:', error);
                setExpandedSource(prev => prev === source ? null : prev);
            } finally {
                setSourceDetailsLoading(prev => prev === source ? null : prev);
            }
        }
    }, [expandedSource, sourceDetails, period, customRange, excludeBots]);

    /**
     * Fetch all analytics data for the selected period. Runs all requests in
     * parallel for performance.
     *
     * A monotonic request-id ref guards against stale in-flight responses:
     * rapidly changing the period, range, or bot filter — or a slow background
     * tick resolving after a newer foreground load — leaves an older request to
     * finish last, and without the guard its `Promise.all` would overwrite every
     * panel with data for the wrong window. Each call captures an incremented id
     * and only writes state while that id is still current, mirroring the
     * Crawler/Traffic dashboards. The current request also owns the page-level
     * loading flag so a superseding background tick can't strand it on.
     *
     * @param background - When true this is an auto-refresh tick, not a
     *   control-driven load: keep the current data on screen (no loading blank)
     *   and preserve any open traffic-source drill-down instead of resetting it,
     *   so a periodic refresh never disrupts what the operator is reading.
     */
    const reqIdRef = useRef(0);
    const fetchAll = useCallback(async (background = false) => {
        const reqId = ++reqIdRef.current;
        if (!background) {
            setLoading(true);
            setExpandedSource(null);
            setSourceDetails({});
        }
        try {
            const [
                funnelRes,
                sourcesRes,
                pagesRes,
                geoRes,
                deviceRes,
                campaignRes,
                retentionRes,
                overviewRes,
            ] = await Promise.all([
                adminGetConversionFunnel(period, customRange, excludeBots),
                adminGetTrafficSources(period, customRange, excludeBots),
                adminGetTopLandingPages({ period, limit: 15, customRange, excludeBots }),
                adminGetGeoDistribution({ period, limit: 20, customRange, excludeBots }),
                adminGetDeviceBreakdown(period, customRange, excludeBots),
                adminGetCampaignPerformance({ period, limit: 15, customRange, excludeBots }),
                adminGetRetention(period, customRange, excludeBots),
                adminGetAnalyticsOverview(),
            ]);

            // Drop this response if a newer fetch has superseded it, so a slower
            // earlier request can never overwrite fresher data.
            if (reqId !== reqIdRef.current) return;

            setFunnel(funnelRes.stages);
            setTrafficSources(sourcesRes.sources);
            setTrafficTotal(sourcesRes.total);
            setLandingPages(pagesRes.pages);
            setGeoData(geoRes.countries);
            setDevices(deviceRes.devices);
            setCampaigns(campaignRes.campaigns);
            setRetention(retentionRes.data);
            setOverview(overviewRes);
        } catch (error) {
            console.error('Failed to fetch analytics:', error);
        } finally {
            // Only the latest request clears loading — guarding by id (not by the
            // background flag) lets a superseding background tick clear a blank a
            // superseded foreground load left set, avoiding a stranded spinner.
            if (reqId === reqIdRef.current) {
                setLoading(false);
            }
        }
    }, [period, customRange, excludeBots]);

    // Foreground load: runs on mount and whenever a control (period, range, bot
    // filter) changes, showing the loading state.
    useEffect(() => {
        fetchAll();
    }, [fetchAll]);

    // Background auto-refresh: re-pull in place on each page-level refresh tick.
    // The latest fetchAll is read through a ref so this effect depends only on
    // refreshSignal — depending on fetchAll directly would both double-fetch on
    // every control change and, worse, let a tick fire a stale-closure fetch for
    // the previously-selected window. A mount guard skips the initial signal so
    // the foreground effect owns the first load.
    const fetchAllRef = useRef(fetchAll);
    fetchAllRef.current = fetchAll;
    const didMountRef = useRef(false);
    useEffect(() => {
        if (!didMountRef.current) {
            didMountRef.current = true;
            return;
        }
        fetchAllRef.current(true);
    }, [refreshSignal]);

    /** Build chart series for the retention line chart. */
    const retentionSeries: ChartSeries[] = [
        {
            id: 'new',
            label: 'New Visitors',
            data: retention.map(r => ({ date: r.date, value: r.newVisitors })),
            color: resolveCSSColor('--color-primary', '#4b8cff')
        },
        {
            id: 'returning',
            label: 'Returning Visitors',
            data: retention.map(r => ({ date: r.date, value: r.returningVisitors })),
            color: resolveCSSColor('--color-success', '#57d48c')
        }
    ];

    /** Maximum visitors in traffic sources for bar scaling. */
    const maxSourceCount = trafficSources.length > 0
        ? trafficSources[0].visitors
        : 1;

    /** Maximum visitors in landing pages for bar scaling. */
    const maxPageVisitors = landingPages.length > 0
        ? landingPages[0].visitors
        : 1;

    /** Maximum count in geo data for bar scaling. */
    const maxGeoCount = geoData.length > 0
        ? geoData[0].count
        : 1;

    /** Site-wide account figures, as label-and-value rows. */
    const accountRows: IFigureListRow[] = overview
        ? [
            { key: 'total', label: 'Total accounts', value: overview.totalAccounts.toLocaleString() },
            { key: 'wallet', label: 'With a wallet', value: overview.accountsWithWallets.toLocaleString() },
            { key: 'adoption', label: 'Wallet adoption', value: `${Math.round(overview.walletAdoptionRate * 100)}%` }
        ]
        : [];

    return (
        <Stack gap="md">
            {/* Overview headline — KPI strip + unified trend (owns its fetch) */}
            <OverviewTrend period={period} customRange={customRange} includeBots={includeBots} refreshSignal={refreshSignal} />

            {loading ? (
                <p className={styles.loading}>Loading analytics data…</p>
            ) : (
                <>
                    {/* Sources and landing pages: both tables need width, so the
                        band's floor is the wide one and they stack below it. */}
                    <Grid columns="responsive" gap="sm" className={`${styles.band} ${styles.band__wide}`}>
                        <Panel
                            title="Traffic sources"
                            titleAs="h3"
                            meta={(
                                <span title="Session-scoped attribution: every session starting in this window credits the referrer it arrived on, so a visitor returning through a new source now appears under it — first-touch credited only their first-ever visit. The figure shown stays distinct visitors, so returning through the same source does not count twice. A session resumed after the 30-minute idle gap is excluded rather than counted as direct — a reopened tab arrived from nowhere.">
                                    By session{trafficTotal > 0 ? `, ${trafficTotal.toLocaleString()} visitors` : ''}. Select a row for detail.
                                </span>
                            )}
                        >
                            {trafficSources.length === 0 ? (
                                <p className={styles.empty_state}>No traffic data for this period.</p>
                            ) : (
                                <Table variant="compact" flush className={styles.dense_table}>
                                    <Thead>
                                        <Tr>
                                            <Th scope="col" width="shrink" aria-label="Expand" />
                                            <Th scope="col" width="expand">Source</Th>
                                            <Th scope="col" width="shrink">Category</Th>
                                            <Th scope="col" width="shrink" numeric>Visitors</Th>
                                            <Th scope="col" width="shrink" numeric>%</Th>
                                        </Tr>
                                    </Thead>
                                    <Tbody>
                                        {trafficSources.map(s => {
                                            const isExpanded = expandedSource === s.source;
                                            const details = sourceDetails[s.source];
                                            const isLoading = sourceDetailsLoading === s.source;
                                            return (
                                                <React.Fragment key={s.source}>
                                                    <Tr
                                                        className={`${styles.row_clickable} ${isExpanded ? styles.row_expanded : ''}`}
                                                        onClick={() => toggleSourceDetails(s.source)}
                                                        role="button"
                                                        tabIndex={0}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter' || e.key === ' ') {
                                                                e.preventDefault();
                                                                toggleSourceDetails(s.source);
                                                            }
                                                        }}
                                                        aria-expanded={isExpanded}
                                                    >
                                                        <Td muted className={styles.expand_cell}>
                                                            {isExpanded
                                                                ? <ChevronDown size={14} aria-hidden="true" />
                                                                : <ChevronRight size={14} aria-hidden="true" />}
                                                        </Td>
                                                        <Td className={styles.truncate} title={s.source}>{s.source}</Td>
                                                        <Td>
                                                            <Badge size="xs" {...getCategoryBadgeProps(s.category)}>
                                                                {s.category}
                                                            </Badge>
                                                        </Td>
                                                        <Td numeric>
                                                            <ShareFigure value={s.visitors} max={maxSourceCount} />
                                                        </Td>
                                                        <Td numeric muted>{s.percentage}%</Td>
                                                    </Tr>
                                                    {isExpanded && (
                                                        <Tr className={styles.detail_row}>
                                                            <Td colSpan={SOURCE_COLUMN_COUNT} className={styles.detail_row__cell}>
                                                                {isLoading ? (
                                                                    <p className={styles.loading}>Loading details…</p>
                                                                ) : details ? (
                                                                    <SourceDetail details={details} />
                                                                ) : null}
                                                            </Td>
                                                        </Tr>
                                                    )}
                                                </React.Fragment>
                                            );
                                        })}
                                    </Tbody>
                                </Table>
                            )}
                        </Panel>

                        <Panel
                            title="Top landing pages"
                            titleAs="h3"
                            meta={(
                                <span title="Session-scoped attribution: the entry page of every session starting in this window, so a returning visitor's re-entry page now appears here — not the most-viewed pages. The figure shown stays distinct visitors, so re-entering on the same page does not count twice. Sessions resumed after the 30-minute idle gap are excluded; nobody landed on them.">
                                    By session, distinct visitors
                                </span>
                            )}
                        >
                            {landingPages.length === 0 ? (
                                <p className={styles.empty_state}>No landing page data for this period.</p>
                            ) : (
                                <Table variant="compact" flush className={styles.dense_table}>
                                    <Thead>
                                        <Tr>
                                            <Th scope="col" width="expand">Page</Th>
                                            <Th scope="col" width="shrink" numeric>Visitors</Th>
                                        </Tr>
                                    </Thead>
                                    <Tbody>
                                        {landingPages.map(p => (
                                            <Tr key={p.path}>
                                                <Td className={`${styles.truncate} ${styles.mono}`} title={p.path}>{p.path}</Td>
                                                <Td numeric>
                                                    <ShareFigure value={p.visitors} max={maxPageVisitors} />
                                                </Td>
                                            </Tr>
                                        ))}
                                    </Tbody>
                                </Table>
                            )}
                        </Panel>
                    </Grid>

                    {/* Narrow sections three across: the tall geography table,
                        a column of the three short lists, and the retention chart. */}
                    <Grid columns="responsive" gap="sm" className={`${styles.band} ${styles.band__narrow}`}>
                        <Panel title="Geography" titleAs="h3" meta="Distinct visitors by country">
                            {geoData.length === 0 ? (
                                <p className={styles.empty_state}>No geographic data for this period.</p>
                            ) : (
                                <Table variant="compact" flush className={styles.dense_table}>
                                    <Thead>
                                        <Tr>
                                            <Th scope="col" width="expand">Country</Th>
                                            <Th scope="col" width="shrink" numeric>Visitors</Th>
                                            <Th scope="col" width="shrink" numeric>%</Th>
                                        </Tr>
                                    </Thead>
                                    <Tbody>
                                        {geoData.map(g => (
                                            <Tr key={g.country}>
                                                <Td>{g.country}</Td>
                                                <Td numeric>
                                                    <ShareFigure value={g.count} max={maxGeoCount} />
                                                </Td>
                                                <Td numeric muted>{g.percentage}%</Td>
                                            </Tr>
                                        ))}
                                    </Tbody>
                                </Table>
                            )}
                        </Panel>

                        <Stack gap="sm">
                            {funnel.length > 0 && (
                                <Panel
                                    title="Conversion funnel"
                                    titleAs="h3"
                                    meta={(
                                        <span title="Counts are unique visitors (browser identities / tids), not accounts. One person logged in from two browsers or devices counts as two logged-in visitors but one account, so these stages nest under Visitors and never exceed it.">
                                            Unique visitors
                                        </span>
                                    )}
                                >
                                    <BarList
                                        label="Conversion funnel"
                                        rows={funnel.map(stage => ({
                                            key: stage.stage,
                                            label: stage.stage,
                                            value: stage.count,
                                            figure: `${stage.count.toLocaleString()} (${stage.percentage}%)`
                                        }))}
                                    />
                                </Panel>
                            )}

                            <Panel title="Devices" titleAs="h3">
                                {devices.length === 0 ? (
                                    <p className={styles.empty_state}>No device data for this period.</p>
                                ) : (
                                    <BarList
                                        label="Device breakdown"
                                        rows={devices.map(d => ({
                                            key: d.device,
                                            label: d.device,
                                            value: d.count,
                                            figure: `${d.count.toLocaleString()} (${d.percentage}%)`
                                        }))}
                                    />
                                )}
                            </Panel>

                            {/* Account Overview (Better Auth) — site-wide, not time-windowed */}
                            {overview && (
                                <Panel title="Accounts" titleAs="h3" meta="Site-wide, not windowed">
                                    <FigureList rows={accountRows} columns="single" label="Accounts" />
                                </Panel>
                            )}
                        </Stack>

                        {/* Retention Chart: New vs Returning. Identity is the
                            tronrelic_tid cookie, so "new" is per-browser — cookie
                            clearing and multi-device use overcount new visitors.
                            The tooltip keeps that honesty ceiling visible. */}
                        {retention.length > 0 && (
                            <Panel
                                title="New vs returning"
                                titleAs="h3"
                                meta={(
                                    <span title="Visitor identity is cookie-based: 'new' means a browser not seen before. Cleared cookies and multiple devices count the same person as new again.">
                                        Per browser
                                    </span>
                                )}
                            >
                                <LineChart
                                    series={retentionSeries}
                                    height={220}
                                    yAxisFormatter={(v) => v.toLocaleString()}
                                    emptyLabel="No retention data for this period"
                                />
                            </Panel>
                        )}
                    </Grid>

                    {campaigns.length > 0 && (
                        <Panel title="Campaign performance" titleAs="h3" meta="UTM-tagged first touches">
                            <Table variant="compact" flush className={styles.dense_table}>
                                <Thead>
                                    <Tr>
                                        <Th scope="col">Source</Th>
                                        <Th scope="col">Medium</Th>
                                        <Th scope="col" width="expand">Campaign</Th>
                                        <Th scope="col" width="shrink" numeric>Visitors</Th>
                                        <Th
                                            scope="col"
                                            width="shrink"
                                            numeric
                                            title="Visitors logged in at any point during the window — includes returning account holders, not only new signups"
                                        >
                                            Logged in
                                        </Th>
                                        <Th scope="col" width="shrink" numeric title="Logged-in visitors / visitors">
                                            Login %
                                        </Th>
                                    </Tr>
                                </Thead>
                                <Tbody>
                                    {campaigns.map(c => (
                                        <Tr key={`${c.source}|${c.medium}|${c.campaign}`}>
                                            <Td>{c.source}</Td>
                                            <Td muted>{c.medium}</Td>
                                            <Td>{c.campaign}</Td>
                                            <Td numeric>{c.visitors.toLocaleString()}</Td>
                                            <Td numeric>{c.conversions}</Td>
                                            <Td numeric muted>{c.conversionRate}%</Td>
                                        </Tr>
                                    ))}
                                </Tbody>
                            </Table>
                        </Panel>
                    )}
                </>
            )}
        </Stack>
    );
}
