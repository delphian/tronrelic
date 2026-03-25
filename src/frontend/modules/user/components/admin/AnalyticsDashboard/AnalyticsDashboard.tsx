/**
 * AnalyticsDashboard Component
 *
 * Admin analytics dashboard displaying aggregate traffic insights across
 * all visitors. Surfaces actionable data for SEO optimization, campaign
 * evaluation, and conversion tracking.
 *
 * Sections:
 * 1. Engagement summary cards (avg duration, pages/session, bounce rate)
 * 2. Conversion funnel (visitors → return → wallet → verified)
 * 3. Traffic sources breakdown (direct, organic, social, referral)
 * 4. Top landing pages with engagement metrics
 * 5. Geographic distribution by country
 * 6. Device and screen size breakdown
 * 7. UTM campaign performance with conversion rates
 * 8. New vs returning visitor retention chart
 */

'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
    Users, TrendingUp, MousePointerClick,
    Globe, Smartphone, BarChart3, Target, ChevronDown, ChevronRight
} from 'lucide-react';
import { LineChart } from '../../../../../features/charts/components/LineChart';
import type { ChartSeries } from '../../../../../features/charts/components/LineChart';
import { Button } from '../../../../../components/ui/Button';
import {
    adminGetTrafficSources,
    adminGetTrafficSourceDetails,
    adminGetTopLandingPages,
    adminGetGeoDistribution,
    adminGetDeviceBreakdown,
    adminGetCampaignPerformance,
    adminGetEngagement,
    adminGetConversionFunnel,
    adminGetRetention,
} from '../../../api';
import type {
    AnalyticsPeriod,
    ITrafficSource,
    ITrafficSourceDetails,
    ILandingPage,
    IGeoEntry,
    IDeviceEntry,
    ICampaignEntry,
    IEngagementMetrics,
    IFunnelStage,
    IRetentionEntry,
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

/** Period option labels for display. */
const PERIOD_OPTIONS: { value: AnalyticsPeriod; label: string }[] = [
    { value: '24h', label: '24 Hours' },
    { value: '7d', label: '7 Days' },
    { value: '30d', label: '30 Days' },
    { value: '90d', label: '90 Days' },
];

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
 * Get CSS class for a traffic source category badge.
 *
 * @param category - Source category string
 * @returns CSS module class name
 */
function getCategoryClass(category: string): string {
    switch (category) {
        case 'direct': return styles['category_badge--direct'];
        case 'organic': return styles['category_badge--organic'];
        case 'social': return styles['category_badge--social'];
        default: return styles['category_badge--referral'];
    }
}

interface Props {
    /** Admin authentication token for API requests. */
    token: string;
}

/**
 * Aggregate analytics dashboard for admin traffic insights.
 *
 * Fetches data from multiple analytics endpoints and renders engagement
 * metrics, conversion funnel, traffic sources, landing pages, geography,
 * devices, campaigns, and retention data with period filtering.
 *
 * @param props - Component props
 * @param props.token - Admin API token from localStorage
 */
export function AnalyticsDashboard({ token }: Props) {
    const [period, setPeriod] = useState<AnalyticsPeriod>('24h');
    const [loading, setLoading] = useState(true);

    // Data state
    const [engagement, setEngagement] = useState<IEngagementMetrics | null>(null);
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
                const details = await adminGetTrafficSourceDetails(token, source, period);
                setSourceDetails(prev => ({ ...prev, [source]: details }));
            } catch (error) {
                console.error('Failed to fetch source details:', error);
                setExpandedSource(prev => prev === source ? null : prev);
            } finally {
                setSourceDetailsLoading(prev => prev === source ? null : prev);
            }
        }
    }, [expandedSource, sourceDetails, token, period]);

    /**
     * Fetch all analytics data for the selected period.
     * Runs all requests in parallel for performance.
     */
    const fetchAll = useCallback(async () => {
        setLoading(true);
        setExpandedSource(null);
        setSourceDetails({});
        try {
            const [
                engagementRes,
                funnelRes,
                sourcesRes,
                pagesRes,
                geoRes,
                deviceRes,
                campaignRes,
                retentionRes,
            ] = await Promise.all([
                adminGetEngagement(token, period),
                adminGetConversionFunnel(token, period),
                adminGetTrafficSources(token, period),
                adminGetTopLandingPages(token, { period, limit: 15 }),
                adminGetGeoDistribution(token, { period, limit: 20 }),
                adminGetDeviceBreakdown(token, period),
                adminGetCampaignPerformance(token, { period, limit: 15 }),
                adminGetRetention(token, period),
            ]);

            setEngagement(engagementRes);
            setFunnel(funnelRes.stages);
            setTrafficSources(sourcesRes.sources);
            setTrafficTotal(sourcesRes.total);
            setLandingPages(pagesRes.pages);
            setGeoData(geoRes.countries);
            setDevices(deviceRes.devices);
            setCampaigns(campaignRes.campaigns);
            setRetention(retentionRes.data);
        } catch (error) {
            console.error('Failed to fetch analytics:', error);
        } finally {
            setLoading(false);
        }
    }, [token, period]);

    useEffect(() => {
        fetchAll();
    }, [fetchAll]);

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

    /** Maximum count in traffic sources for bar scaling. */
    const maxSourceCount = trafficSources.length > 0
        ? trafficSources[0].count
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
        <div className={styles.dashboard}>
            {/* Period selector */}
            <div className={styles.controls}>
                <span className={styles.controls__label}>Period:</span>
                {PERIOD_OPTIONS.map(opt => (
                    <Button
                        key={opt.value}
                        variant={period === opt.value ? 'primary' : 'secondary'}
                        size="sm"
                        onClick={() => setPeriod(opt.value)}
                    >
                        {opt.label}
                    </Button>
                ))}
            </div>

            {loading ? (
                <div className={styles.loading}>Loading analytics data...</div>
            ) : (
                <>
                    {/* Engagement Summary Cards */}
                    {engagement && (
                        <section>
                            <h3 className={styles.section_title}>
                                <TrendingUp size={16} className={styles.section_title__icon} />
                                Engagement Overview
                            </h3>
                            <div className={styles.metrics_grid}>
                                <div className={`surface ${styles.metric_card}`}>
                                    <div className={styles.metric_card__value}>
                                        {engagement.totalUsers.toLocaleString()}
                                    </div>
                                    <div className={styles.metric_card__label}>Active Visitors</div>
                                </div>
                                <div className={`surface ${styles.metric_card}`}>
                                    <div className={styles.metric_card__value}>
                                        {formatDuration(engagement.avgSessionDuration)}
                                    </div>
                                    <div className={styles.metric_card__label}>Avg Session Duration</div>
                                </div>
                                <div className={`surface ${styles.metric_card}`}>
                                    <div className={styles.metric_card__value}>
                                        {engagement.avgPagesPerSession}
                                    </div>
                                    <div className={styles.metric_card__label}>Pages / Session</div>
                                </div>
                                <div className={`surface ${styles.metric_card}`}>
                                    <div className={styles.metric_card__value}>
                                        {engagement.bounceRate}%
                                    </div>
                                    <div className={styles.metric_card__label}>Bounce Rate</div>
                                </div>
                            </div>
                        </section>
                    )}

                    {/* Conversion Funnel */}
                    {funnel.length > 0 && (
                        <section>
                            <h3 className={styles.section_title}>
                                <Target size={16} className={styles.section_title__icon} />
                                Conversion Funnel
                            </h3>
                            <div className="surface surface--padding-md">
                                <div className={styles.funnel}>
                                    {funnel.map(stage => (
                                        <div key={stage.stage} className={styles.funnel_stage}>
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
                            </div>
                        </section>
                    )}

                    {/* Traffic Sources + Top Landing Pages side by side */}
                    <div className={styles.split_grid}>
                        {/* Traffic Sources */}
                        <section>
                            <h3 className={styles.section_title}>
                                <Globe size={16} className={styles.section_title__icon} />
                                Traffic Sources
                                {trafficTotal > 0 && (
                                    <span className={`text-muted ${styles.section_title__subtitle}`}>
                                        ({trafficTotal.toLocaleString()} visitors)
                                    </span>
                                )}
                            </h3>
                            <div className="surface surface--padding-sm">
                                {trafficSources.length === 0 ? (
                                    <div className={styles.empty_state}>No traffic data for this period</div>
                                ) : (
                                    <div className={styles.table_wrapper}>
                                        <table className={styles.table}>
                                            <thead>
                                                <tr>
                                                    <th className={styles.table__expand_cell}></th>
                                                    <th>Source</th>
                                                    <th>Category</th>
                                                    <th className={styles.table__number}>Visitors</th>
                                                    <th className={styles.table__bar_cell}></th>
                                                    <th className={styles.table__number}>%</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {trafficSources.map(s => {
                                                    const isExpanded = expandedSource === s.source;
                                                    const details = sourceDetails[s.source];
                                                    const isLoading = sourceDetailsLoading === s.source;
                                                    return (
                                                        <React.Fragment key={s.source}>
                                                            <tr
                                                                className={styles.table__row_clickable}
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
                                                                <td className={styles.table__expand_cell}>
                                                                    {isExpanded
                                                                        ? <ChevronDown size={14} />
                                                                        : <ChevronRight size={14} />
                                                                    }
                                                                </td>
                                                                <td>{s.source}</td>
                                                                <td>
                                                                    <span className={`${styles.category_badge} ${getCategoryClass(s.category)}`}>
                                                                        {s.category}
                                                                    </span>
                                                                </td>
                                                                <td className={styles.table__number}>{s.count.toLocaleString()}</td>
                                                                <td className={styles.table__bar_cell}>
                                                                    <div
                                                                        className={styles.table__bar}
                                                                        style={{ width: `${(s.count / maxSourceCount) * 100}%` }}
                                                                    />
                                                                </td>
                                                                <td className={styles.table__number}>{s.percentage}%</td>
                                                            </tr>
                                                            {isExpanded && (
                                                                <tr className={styles.detail_row}>
                                                                    <td colSpan={6} className={styles.detail_row__cell}>
                                                                        {isLoading ? (
                                                                            <div className={styles.detail_loading}>Loading details...</div>
                                                                        ) : details ? (
                                                                            <div className={styles.detail_grid}>
                                                                                {/* Engagement + Conversion cards */}
                                                                                <div className={styles.detail_cards}>
                                                                                    <div className={styles.detail_card}>
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
                                                                                    <div className={styles.detail_card}>
                                                                                        <span className={styles.detail_card__value}>
                                                                                            {formatDuration(details.engagement.avgDuration)}
                                                                                        </span>
                                                                                        <span className={styles.detail_card__label}>Avg Duration</span>
                                                                                    </div>
                                                                                    <div className={styles.detail_card}>
                                                                                        <span className={styles.detail_card__value}>
                                                                                            {details.conversion.conversionRate}%
                                                                                        </span>
                                                                                        <span className={styles.detail_card__label}>Wallet Conversion</span>
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
                                                                                            <span className={styles.gsc_badge}>Search Console</span>
                                                                                        </h4>
                                                                                        <table className={styles.gsc_table}>
                                                                                            <thead>
                                                                                                <tr>
                                                                                                    <th className={styles.gsc_table__keyword}>Keyword</th>
                                                                                                    <th className={styles.gsc_table__metric}>Clicks</th>
                                                                                                    <th className={styles.gsc_table__metric}>Impr.</th>
                                                                                                    <th className={styles.gsc_table__metric}>CTR</th>
                                                                                                    <th className={styles.gsc_table__metric}>Pos.</th>
                                                                                                </tr>
                                                                                            </thead>
                                                                                            <tbody>
                                                                                                {details.gscKeywords.map(kw => (
                                                                                                    <tr key={kw.keyword}>
                                                                                                        <td className={styles.gsc_table__keyword}>{kw.keyword}</td>
                                                                                                        <td className={styles.gsc_table__metric}>{kw.clicks.toLocaleString()}</td>
                                                                                                        <td className={styles.gsc_table__metric}>{kw.impressions.toLocaleString()}</td>
                                                                                                        <td className={styles.gsc_table__metric}>{(kw.ctr * 100).toFixed(1)}%</td>
                                                                                                        <td className={styles.gsc_table__metric}>{kw.position.toFixed(1)}</td>
                                                                                                    </tr>
                                                                                                ))}
                                                                                            </tbody>
                                                                                        </table>
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
                                                                    </td>
                                                                </tr>
                                                            )}
                                                        </React.Fragment>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </section>

                        {/* Top Landing Pages */}
                        <section>
                            <h3 className={styles.section_title}>
                                <MousePointerClick size={16} className={styles.section_title__icon} />
                                Top Landing Pages
                            </h3>
                            <div className="surface surface--padding-sm">
                                {landingPages.length === 0 ? (
                                    <div className={styles.empty_state}>No landing page data for this period</div>
                                ) : (
                                    <div className={styles.table_wrapper}>
                                        <table className={styles.table}>
                                            <thead>
                                                <tr>
                                                    <th>Page</th>
                                                    <th className={styles.table__number}>Visitors</th>
                                                    <th className={styles.table__bar_cell}></th>
                                                    <th className={styles.table__number}>Avg Sessions</th>
                                                    <th className={styles.table__number}>Avg Views</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {landingPages.map(p => (
                                                    <tr key={p.path}>
                                                        <td>{p.path}</td>
                                                        <td className={styles.table__number}>{p.visitors.toLocaleString()}</td>
                                                        <td className={styles.table__bar_cell}>
                                                            <div
                                                                className={styles.table__bar}
                                                                style={{ width: `${(p.visitors / maxPageVisitors) * 100}%` }}
                                                            />
                                                        </td>
                                                        <td className={styles.table__number}>{p.avgSessions}</td>
                                                        <td className={styles.table__number}>{p.avgPageViews}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </section>
                    </div>

                    {/* Geography + Devices side by side */}
                    <div className={styles.split_grid}>
                        {/* Geographic Distribution */}
                        <section>
                            <h3 className={styles.section_title}>
                                <Globe size={16} className={styles.section_title__icon} />
                                Geographic Distribution
                            </h3>
                            <div className="surface surface--padding-sm">
                                {geoData.length === 0 ? (
                                    <div className={styles.empty_state}>No geographic data for this period</div>
                                ) : (
                                    <div className={styles.table_wrapper}>
                                        <table className={styles.table}>
                                            <thead>
                                                <tr>
                                                    <th>Country</th>
                                                    <th className={styles.table__number}>Visitors</th>
                                                    <th className={styles.table__bar_cell}></th>
                                                    <th className={styles.table__number}>%</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {geoData.map(g => (
                                                    <tr key={g.country}>
                                                        <td>{g.country}</td>
                                                        <td className={styles.table__number}>{g.count.toLocaleString()}</td>
                                                        <td className={styles.table__bar_cell}>
                                                            <div
                                                                className={styles.table__bar}
                                                                style={{ width: `${(g.count / maxGeoCount) * 100}%` }}
                                                            />
                                                        </td>
                                                        <td className={styles.table__number}>{g.percentage}%</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </section>

                        {/* Device Breakdown */}
                        <section>
                            <h3 className={styles.section_title}>
                                <Smartphone size={16} className={styles.section_title__icon} />
                                Device Breakdown
                            </h3>
                            <div className="surface surface--padding-md">
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
                        </section>
                    </div>

                    {/* Campaign Performance */}
                    {campaigns.length > 0 && (
                        <section>
                            <h3 className={styles.section_title}>
                                <BarChart3 size={16} className={styles.section_title__icon} />
                                Campaign Performance (UTM)
                            </h3>
                            <div className="surface surface--padding-sm">
                                <div className={styles.table_wrapper}>
                                    <table className={styles.table}>
                                        <thead>
                                            <tr>
                                                <th>Source</th>
                                                <th>Medium</th>
                                                <th>Campaign</th>
                                                <th className={styles.table__number}>Visitors</th>
                                                <th className={styles.table__number}>Wallets</th>
                                                <th className={styles.table__number}>Verified</th>
                                                <th className={styles.table__number}>Conv %</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {campaigns.map(c => (
                                                <tr key={`${c.source}|${c.medium}|${c.campaign}`}>
                                                    <td>{c.source}</td>
                                                    <td>{c.medium}</td>
                                                    <td>{c.campaign}</td>
                                                    <td className={styles.table__number}>{c.visitors.toLocaleString()}</td>
                                                    <td className={styles.table__number}>{c.walletsConnected}</td>
                                                    <td className={styles.table__number}>{c.walletsVerified}</td>
                                                    <td className={styles.table__number}>{c.conversionRate}%</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </section>
                    )}

                    {/* Retention Chart: New vs Returning */}
                    {retention.length > 0 && (
                        <section>
                            <h3 className={styles.section_title}>
                                <Users size={16} className={styles.section_title__icon} />
                                New vs Returning Visitors
                            </h3>
                            <div className="surface surface--padding-md">
                                <LineChart
                                    series={retentionSeries}
                                    height={280}
                                    yAxisFormatter={(v) => v.toLocaleString()}
                                    emptyLabel="No retention data for this period"
                                />
                            </div>
                        </section>
                    )}
                </>
            )}
        </div>
    );
}
