/**
 * AnalyticsDashboard Component
 *
 * Admin analytics dashboard displaying aggregate traffic insights across
 * all visitors. Surfaces actionable data for SEO optimization, campaign
 * evaluation, and conversion tracking.
 *
 * Sections:
 * 1. Overview headline — KPI strip with period deltas + unified trend chart
 * 2. Conversion funnel (visitors → logged in → new accounts)
 * 3. Traffic sources breakdown (direct, organic, social, referral)
 * 4. Top landing pages
 * 5. Geographic distribution by country
 * 6. Device breakdown
 * 7. UTM campaign performance with conversion rates
 * 8. New vs returning visitor retention chart
 * 9. Better Auth account overview
 *
 * The lookback period, custom range, and bot filter arrive as props from the
 * page-level global controls so every tab reads the same window. All table
 * primary numbers are distinct visitors, matching analytics-platform
 * convention; raw event counts remain available server-side.
 */

'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
    Users, MousePointerClick,
    Globe, Smartphone, BarChart3, Target, ChevronDown, ChevronRight
} from 'lucide-react';
import { LineChart } from '../../../../../features/charts/components/LineChart';
import type { ChartSeries } from '../../../../../features/charts/components/LineChart';
import { Card } from '../../../../../components/ui/Card';
import { Badge, type BadgeTone } from '../../../../../components/ui/Badge';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../components/ui/Table';
import { Grid, Stack } from '../../../../../components/layout';
import { OverviewTrend } from '../OverviewTrend';
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

    return (
        <Stack gap="lg">
            {/* Overview headline — KPI strip + unified trend (owns its fetch) */}
            <OverviewTrend period={period} customRange={customRange} includeBots={includeBots} refreshSignal={refreshSignal} />

            {loading ? (
                <div className={styles.loading}>Loading analytics data...</div>
            ) : (
                <>
                    {/* Conversion Funnel + Traffic Sources side by side */}
                    <Grid columns="responsive">
                        {/* Conversion Funnel */}
                        {funnel.length > 0 && (
                            <Card>
                                <h3 className={styles.section_title}>
                                    <Target size={16} className={styles.section_title__icon} />
                                    Conversion Funnel
                                </h3>
                                <div className={styles.funnel}>
                                    {funnel.map(stage => (
                                        <div
                                            key={stage.stage}
                                            className={styles.funnel_stage}
                                            title="Counts are unique visitors (browser identities / tids), not accounts. One person logged in from two browsers or devices counts as two logged-in visitors but one account, so these stages nest under Visitors and never exceed it."
                                        >
                                            <span className={styles.funnel_stage__label}>{stage.stage}</span>
                                            <div className={styles.funnel_stage__bar_wrapper}>
                                                <div
                                                    className={styles.funnel_stage__bar}
                                                    style={{ width: `${stage.percentage}%` }}
                                                />
                                            </div>
                                            <span className={styles.funnel_stage__stats}>
                                                {stage.count.toLocaleString()} ({stage.percentage}%)
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </Card>
                        )}

                        {/* Traffic Sources */}
                        <Card>
                            <h3
                                className={styles.section_title}
                                title="First-touch attribution: each visitor credits the referrer of their first-ever visit, permanently — like GA4's 'First user source', not its session-scoped Traffic acquisition report"
                            >
                                <Globe size={16} className={styles.section_title__icon} />
                                Traffic Sources
                                <span className={`text-muted ${styles.section_title__subtitle}`}>
                                    (first-touch{trafficTotal > 0 ? ` · ${trafficTotal.toLocaleString()} visitors` : ''})
                                </span>
                            </h3>
                            <div>
                                {trafficSources.length === 0 ? (
                                    <div className={styles.empty_state}>No traffic data for this period</div>
                                ) : (
                                    <div className={styles.table_wrapper}>
                                        <Table>
                                            <Thead>
                                                <Tr>
                                                    <Th scope="col" className={styles.table__expand_cell}></Th>
                                                    <Th scope="col">Source</Th>
                                                    <Th scope="col">Category</Th>
                                                    <Th scope="col" className={styles.table__number}>Visitors</Th>
                                                    <Th scope="col" className={styles.table__bar_cell}></Th>
                                                    <Th scope="col" className={styles.table__number}>%</Th>
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
                                                                className={`${styles.table__row_clickable} ${isExpanded ? styles.table__row_expanded : ''}`}
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
                                                                <Td className={styles.table__expand_cell}>
                                                                    {isExpanded
                                                                        ? <ChevronDown size={14} />
                                                                        : <ChevronRight size={14} />
                                                                    }
                                                                </Td>
                                                                <Td>{s.source}</Td>
                                                                <Td>
                                                                    <Badge {...getCategoryBadgeProps(s.category)}>
                                                                        {s.category}
                                                                    </Badge>
                                                                </Td>
                                                                <Td className={styles.table__number}>{s.visitors.toLocaleString()}</Td>
                                                                <Td className={styles.table__bar_cell}>
                                                                    <div
                                                                        className={styles.table__bar}
                                                                        style={{ width: `${(s.visitors / maxSourceCount) * 100}%` }}
                                                                    />
                                                                </Td>
                                                                <Td className={styles.table__number}>{s.percentage}%</Td>
                                                            </Tr>
                                                            {isExpanded && (
                                                                <Tr className={styles.detail_row}>
                                                                    <Td colSpan={6} className={styles.detail_row__cell}>
                                                                        {isLoading ? (
                                                                            <div className={styles.detail_loading}>Loading details...</div>
                                                                        ) : details ? (
                                                                            <div className={styles.detail_grid}>
                                                                                {/* Engagement + Conversion cards. Sessions are
                                                                                    derived server-side from the page-event stream
                                                                                    (30-minute inactivity rule), so these are real
                                                                                    values; a zero means no interactive page views
                                                                                    from this cohort in the window. */}
                                                                                <div className={styles.detail_cards}>
                                                                                    <div
                                                                                        className={styles.detail_card}
                                                                                        title="Derived sessions per visitor (30-minute inactivity rule over page events)"
                                                                                    >
                                                                                        <span className={styles.detail_card__value}>
                                                                                            {details.engagement.avgSessions}
                                                                                        </span>
                                                                                        <span className={styles.detail_card__label}>Avg Sessions</span>
                                                                                    </div>
                                                                                    <div className={styles.detail_card}>
                                                                                        <span className={styles.detail_card__value}>
                                                                                            {details.engagement.avgPageViews}
                                                                                        </span>
                                                                                        <span className={styles.detail_card__label}>Avg Pages</span>
                                                                                    </div>
                                                                                    <div
                                                                                        className={styles.detail_card}
                                                                                        title="Average derived-session duration (last hit minus first hit; single-page sessions count as 0s)"
                                                                                    >
                                                                                        <span className={styles.detail_card__value}>
                                                                                            {formatDuration(details.engagement.avgDuration)}
                                                                                        </span>
                                                                                        <span className={styles.detail_card__label}>Avg Duration</span>
                                                                                    </div>
                                                                                    <div
                                                                                        className={styles.detail_card}
                                                                                        title="Visitors from this source who were logged in at any point during the window (includes returning account holders)"
                                                                                    >
                                                                                        <span className={styles.detail_card__value}>
                                                                                            {details.conversion.conversionRate}%
                                                                                        </span>
                                                                                        <span className={styles.detail_card__label}>Logged-In Rate</span>
                                                                                    </div>
                                                                                </div>

                                                                                {/* Landing Pages */}
                                                                                {details.landingPages.length > 0 && (
                                                                                    <div className={styles.detail_section}>
                                                                                        <h4 className={styles.detail_section__title}>Landing Pages</h4>
                                                                                        <ul className={styles.detail_list}>
                                                                                            {details.landingPages.map(lp => (
                                                                                                <li key={lp.path} className={styles.detail_list__item}>
                                                                                                    <span className={styles.detail_list__label}>{lp.path}</span>
                                                                                                    <span className={styles.detail_list__value}>
                                                                                                        {lp.count} ({lp.percentage}%)
                                                                                                    </span>
                                                                                                </li>
                                                                                            ))}
                                                                                        </ul>
                                                                                    </div>
                                                                                )}

                                                                                {/* Countries + Devices side by side */}
                                                                                <div className={styles.detail_columns}>
                                                                                    {details.countries.length > 0 && (
                                                                                        <div className={styles.detail_section}>
                                                                                            <h4 className={styles.detail_section__title}>Countries</h4>
                                                                                            <ul className={styles.detail_list}>
                                                                                                {details.countries.map(c => (
                                                                                                    <li key={c.country} className={styles.detail_list__item}>
                                                                                                        <span className={styles.detail_list__label}>{c.country}</span>
                                                                                                        <span className={styles.detail_list__value}>
                                                                                                            {c.count} ({c.percentage}%)
                                                                                                        </span>
                                                                                                    </li>
                                                                                                ))}
                                                                                            </ul>
                                                                                        </div>
                                                                                    )}
                                                                                    {details.devices.length > 0 && (
                                                                                        <div className={styles.detail_section}>
                                                                                            <h4 className={styles.detail_section__title}>Devices</h4>
                                                                                            <ul className={styles.detail_list}>
                                                                                                {details.devices.map(d => (
                                                                                                    <li key={d.device} className={styles.detail_list__item}>
                                                                                                        <span className={styles.detail_list__label}>{d.device}</span>
                                                                                                        <span className={styles.detail_list__value}>
                                                                                                            {d.count} ({d.percentage}%)
                                                                                                        </span>
                                                                                                    </li>
                                                                                                ))}
                                                                                            </ul>
                                                                                        </div>
                                                                                    )}
                                                                                </div>

                                                                                {/* Search Keywords — GSC enriched when available */}
                                                                                {(details.gscKeywords && details.gscKeywords.length > 0) ? (
                                                                                    <div className={styles.detail_section}>
                                                                                        <h4 className={styles.detail_section__title}>
                                                                                            Search Keywords
                                                                                            <Badge tone="info" className={styles.gsc_badge}>Search Console</Badge>
                                                                                        </h4>
                                                                                        <Table className={styles.gsc_table}>
                                                                                            <Thead>
                                                                                                <Tr>
                                                                                                    <Th scope="col" className={styles.gsc_table__keyword}>Keyword</Th>
                                                                                                    <Th scope="col" className={styles.gsc_table__metric}>Clicks</Th>
                                                                                                    <Th scope="col" className={styles.gsc_table__metric}>Impr.</Th>
                                                                                                    <Th scope="col" className={styles.gsc_table__metric}>CTR</Th>
                                                                                                    <Th scope="col" className={styles.gsc_table__metric}>Pos.</Th>
                                                                                                </Tr>
                                                                                            </Thead>
                                                                                            <Tbody>
                                                                                                {details.gscKeywords.map(kw => (
                                                                                                    <Tr key={kw.keyword}>
                                                                                                        <Td className={styles.gsc_table__keyword}>{kw.keyword}</Td>
                                                                                                        <Td className={styles.gsc_table__metric}>{kw.clicks.toLocaleString()}</Td>
                                                                                                        <Td className={styles.gsc_table__metric}>{kw.impressions.toLocaleString()}</Td>
                                                                                                        <Td className={styles.gsc_table__metric}>{(kw.ctr * 100).toFixed(1)}%</Td>
                                                                                                        <Td className={styles.gsc_table__metric}>{kw.position.toFixed(1)}</Td>
                                                                                                    </Tr>
                                                                                                ))}
                                                                                            </Tbody>
                                                                                        </Table>
                                                                                    </div>
                                                                                ) : details.searchKeywords.length > 0 ? (
                                                                                    <div className={styles.detail_section}>
                                                                                        <h4 className={styles.detail_section__title}>Search Keywords</h4>
                                                                                        <ul className={styles.detail_list}>
                                                                                            {details.searchKeywords.map(kw => (
                                                                                                <li key={kw.keyword} className={styles.detail_list__item}>
                                                                                                    <span className={styles.detail_list__label}>{kw.keyword}</span>
                                                                                                    <span className={styles.detail_list__value}>{kw.count}</span>
                                                                                                </li>
                                                                                            ))}
                                                                                        </ul>
                                                                                    </div>
                                                                                ) : null}

                                                                                {/* UTM Campaigns (if any) */}
                                                                                {details.utmCampaigns.length > 0 && (
                                                                                    <div className={styles.detail_section}>
                                                                                        <h4 className={styles.detail_section__title}>UTM Campaigns</h4>
                                                                                        <ul className={styles.detail_list}>
                                                                                            {details.utmCampaigns.map(utm => (
                                                                                                <li
                                                                                                    key={`${utm.source}|${utm.medium}|${utm.campaign}`}
                                                                                                    className={styles.detail_list__item}
                                                                                                >
                                                                                                    <span className={styles.detail_list__label}>
                                                                                                        {utm.source} / {utm.medium} / {utm.campaign}
                                                                                                    </span>
                                                                                                    <span className={styles.detail_list__value}>{utm.count}</span>
                                                                                                </li>
                                                                                            ))}
                                                                                        </ul>
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        ) : null}
                                                                    </Td>
                                                                </Tr>
                                                            )}
                                                        </React.Fragment>
                                                    );
                                                })}
                                            </Tbody>
                                        </Table>
                                    </div>
                                )}
                            </div>
                        </Card>
                    </Grid>

                    {/* Top Landing Pages + Geographic Distribution side by side */}
                    <Grid columns="responsive">
                        {/* Top Landing Pages */}
                        <Card>
                            <h3
                                className={styles.section_title}
                                title="First-touch attribution: the entry page of each visitor's first-ever visit — not the most-viewed pages"
                            >
                                <MousePointerClick size={16} className={styles.section_title__icon} />
                                Top Landing Pages
                                <span className={`text-muted ${styles.section_title__subtitle}`}>
                                    (first-touch)
                                </span>
                            </h3>
                            <div>
                                {landingPages.length === 0 ? (
                                    <div className={styles.empty_state}>No landing page data for this period</div>
                                ) : (
                                    <div className={styles.table_wrapper}>
                                        <Table>
                                            <Thead>
                                                <Tr>
                                                    <Th scope="col">Page</Th>
                                                    <Th scope="col" className={styles.table__number}>Visitors</Th>
                                                    <Th scope="col" className={styles.table__bar_cell}></Th>
                                                </Tr>
                                            </Thead>
                                            <Tbody>
                                                {landingPages.map(p => (
                                                    <Tr key={p.path}>
                                                        <Td className={styles.table__truncate} title={p.path}>{p.path}</Td>
                                                        <Td className={styles.table__number}>{p.visitors.toLocaleString()}</Td>
                                                        <Td className={styles.table__bar_cell}>
                                                            <div
                                                                className={styles.table__bar}
                                                                style={{ width: `${(p.visitors / maxPageVisitors) * 100}%` }}
                                                            />
                                                        </Td>
                                                    </Tr>
                                                ))}
                                            </Tbody>
                                        </Table>
                                    </div>
                                )}
                            </div>
                        </Card>

                        {/* Geographic Distribution */}
                        <Card>
                            <h3 className={styles.section_title}>
                                <Globe size={16} className={styles.section_title__icon} />
                                Geographic Distribution
                            </h3>
                            <div>
                                {geoData.length === 0 ? (
                                    <div className={styles.empty_state}>No geographic data for this period</div>
                                ) : (
                                    <div className={styles.table_wrapper}>
                                        <Table>
                                            <Thead>
                                                <Tr>
                                                    <Th scope="col">Country</Th>
                                                    <Th scope="col" className={styles.table__number}>Visitors</Th>
                                                    <Th scope="col" className={styles.table__bar_cell}></Th>
                                                    <Th scope="col" className={styles.table__number}>%</Th>
                                                </Tr>
                                            </Thead>
                                            <Tbody>
                                                {geoData.map(g => (
                                                    <Tr key={g.country}>
                                                        <Td>{g.country}</Td>
                                                        <Td className={styles.table__number}>{g.count.toLocaleString()}</Td>
                                                        <Td className={styles.table__bar_cell}>
                                                            <div
                                                                className={styles.table__bar}
                                                                style={{ width: `${(g.count / maxGeoCount) * 100}%` }}
                                                            />
                                                        </Td>
                                                        <Td className={styles.table__number}>{g.percentage}%</Td>
                                                    </Tr>
                                                ))}
                                            </Tbody>
                                        </Table>
                                    </div>
                                )}
                            </div>
                        </Card>
                    </Grid>

                    {/* Device Breakdown */}
                    <Card>
                        <h3 className={styles.section_title}>
                            <Smartphone size={16} className={styles.section_title__icon} />
                            Device Breakdown
                        </h3>
                        <div>
                            {devices.length === 0 ? (
                                <div className={styles.empty_state}>No device data for this period</div>
                            ) : (
                                <div className={styles.funnel}>
                                    {devices.map(d => (
                                        <div key={d.device} className={styles.funnel_stage}>
                                            <span className={styles.funnel_stage__label}>{d.device}</span>
                                            <div className={styles.funnel_stage__bar_wrapper}>
                                                <div
                                                    className={styles.funnel_stage__bar}
                                                    style={{ width: `${d.percentage}%` }}
                                                />
                                            </div>
                                            <span className={styles.funnel_stage__stats}>
                                                {d.count.toLocaleString()} ({d.percentage}%)
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </Card>

                    {/* Campaign Performance */}
                    {campaigns.length > 0 && (
                        <Card>
                            <h3 className={styles.section_title}>
                                <BarChart3 size={16} className={styles.section_title__icon} />
                                Campaign Performance (UTM)
                            </h3>
                            <div>
                                <div className={styles.table_wrapper}>
                                    <Table>
                                        <Thead>
                                            <Tr>
                                                <Th scope="col">Source</Th>
                                                <Th scope="col">Medium</Th>
                                                <Th scope="col">Campaign</Th>
                                                <Th scope="col" className={styles.table__number}>Visitors</Th>
                                                <Th
                                                    scope="col"
                                                    className={styles.table__number}
                                                    title="Visitors logged in at any point during the window — includes returning account holders, not only new signups"
                                                >
                                                    Logged In
                                                </Th>
                                                <Th
                                                    scope="col"
                                                    className={styles.table__number}
                                                    title="Logged-in visitors / visitors"
                                                >
                                                    Login %
                                                </Th>
                                            </Tr>
                                        </Thead>
                                        <Tbody>
                                            {campaigns.map(c => (
                                                <Tr key={`${c.source}|${c.medium}|${c.campaign}`}>
                                                    <Td>{c.source}</Td>
                                                    <Td>{c.medium}</Td>
                                                    <Td>{c.campaign}</Td>
                                                    <Td className={styles.table__number}>{c.visitors.toLocaleString()}</Td>
                                                    <Td className={styles.table__number}>{c.conversions}</Td>
                                                    <Td className={styles.table__number}>{c.conversionRate}%</Td>
                                                </Tr>
                                            ))}
                                        </Tbody>
                                    </Table>
                                </div>
                            </div>
                        </Card>
                    )}

                    {/* Retention Chart: New vs Returning. Identity is the
                        tronrelic_tid cookie, so "new" is per-browser — cookie
                        clearing and multi-device use overcount new visitors.
                        The tooltip keeps that honesty ceiling visible. */}
                    {retention.length > 0 && (
                        <Card>
                            <h3
                                className={styles.section_title}
                                title="Visitor identity is cookie-based: 'new' means a browser not seen before. Cleared cookies and multiple devices count the same person as new again."
                            >
                                <Users size={16} className={styles.section_title__icon} />
                                New vs Returning Visitors
                            </h3>
                            <LineChart
                                series={retentionSeries}
                                height={280}
                                yAxisFormatter={(v) => v.toLocaleString()}
                                emptyLabel="No retention data for this period"
                            />
                        </Card>
                    )}

                    {/* Account Overview (Better Auth) — site-wide, not time-windowed */}
                    {overview && (
                        <Card>
                            <h3 className={styles.section_title}>
                                <Users size={16} className={styles.section_title__icon} />
                                Accounts
                            </h3>
                            <div className={styles.metrics_grid}>
                                <div className={styles.metric_card}>
                                    <div className={styles.metric_card__value}>
                                        {overview.totalAccounts.toLocaleString()}
                                    </div>
                                    <div className={styles.metric_card__label}>Total Accounts</div>
                                </div>
                                <div className={styles.metric_card}>
                                    <div className={styles.metric_card__value}>
                                        {overview.accountsWithWallets.toLocaleString()}
                                    </div>
                                    <div className={styles.metric_card__label}>With Wallet</div>
                                </div>
                                <div className={styles.metric_card}>
                                    <div className={styles.metric_card__value}>
                                        {Math.round(overview.walletAdoptionRate * 100)}%
                                    </div>
                                    <div className={styles.metric_card__label}>Wallet Adoption</div>
                                </div>
                            </div>
                        </Card>
                    )}
                </>
            )}
        </Stack>
    );
}
