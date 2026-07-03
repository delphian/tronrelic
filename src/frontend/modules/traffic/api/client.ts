/**
 * Traffic module analytics + Google Search Console API client.
 *
 * Typed admin API calls backing the `/system/traffic` analytics dashboards.
 * Visitor counts, traffic-source breakdowns, geo/device distributions,
 * engagement, the binary conversion funnel, the Better Auth account
 * overview, and GSC configuration — all served from the ClickHouse-backed
 * `traffic_events` store via the traffic module's admin routes. The legacy
 * UUID user CRUD, wallet, session, profile, and referral calls were removed
 * in the Better Auth cutover along with the routes that backed them.
 *
 * Authorization rides the same-origin Better Auth session cookie; the
 * backend `requireAdmin` middleware resolves it per request, so no call
 * here carries an explicit admin token.
 */

import { apiClient } from '../../../lib/api';

// ============================================================================
// Visitor Analytics Types
// ============================================================================

/**
 * Daily visitor count data point.
 */
export interface IDailyVisitorData {
    date: string;
    count: number;
}

/** Valid period options for visitor origin queries. */
export type VisitorPeriod = '24h' | '7d' | '30d' | '90d';

/**
 * UTM campaign parameters for traffic origin display.
 */
export interface IUtmParams {
    source?: string;
    medium?: string;
    campaign?: string;
    term?: string;
    content?: string;
}

/**
 * Visitor origin summary for admin analytics.
 *
 * Represents traffic acquisition data from a visitor's first-ever session,
 * combined with lifetime engagement metrics.
 */
export interface IVisitorOrigin {
    userId: string;
    firstSeen: string;
    lastSeen: string;
    country: string | null;
    referrerDomain: string | null;
    landingPage: string | null;
    device: string;
    utm: IUtmParams | null;
    searchKeyword: string | null;
    sessionsCount: number;
    pageViews: number;
    /**
     * First-touch salted subnet hash — an opaque source-correlation key.
     * Identical values mean the same /24 (IPv4) or /48 (IPv6) network;
     * `null` for rows written before the column existed.
     */
    subnetHash: string | null;
}

// ============================================================================
// Visitor Analytics API Functions
// ============================================================================

/**
 * Get daily unique visitor counts for charting (admin endpoint).
 * @param days - Number of days to look back (default: 90)
 * @param options - `excludeBots` restricts counts to human-classified rows
 * @returns Array of daily visitor count data points
 */
export async function adminGetDailyVisitors(days: number = 90,
    options?: { excludeBots?: boolean }
): Promise<IDailyVisitorData[]> {
    // The ClickHouse-backed endpoint takes a date window, not a `days` count;
    // convert. Backend returns { data: [{ day, visitors }] }.
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const response = await apiClient.get('/admin/users/analytics/daily-visitors', {
        params: {
            startDate: since.toISOString(),
            endDate: new Date().toISOString(),
            ...(options?.excludeBots ? { bots: 'exclude' } : {})
        }
    });
    const rows = (response.data as { data?: Array<{ day: string; visitors: number }> }).data ?? [];
    return rows.map(r => ({ date: r.day, count: r.visitors }));
}

/**
 * Get anonymous first touches first seen within the specified period (admin
 * endpoint).
 *
 * A first touch is the earliest `bootstrap` row for a cookieless visitor —
 * server-recorded by the Next.js middleware, so this surface includes bots,
 * crawlers, and unfurlers unless `excludeBots` restricts it to
 * human-classified rows. Filtered by global first-seen (new arrivals in the
 * window) and sorted most recent first.
 * @param options - Period, pagination, and bot-filter options
 * @returns Paginated list of first-touch origins
 */
export async function adminGetAnonymousFirstTouches(options?: { period?: VisitorPeriod; customRange?: { startDate: string; endDate: string }; limit?: number; skip?: number; excludeBots?: boolean }
): Promise<{ visitors: IVisitorOrigin[]; total: number }> {
    const { excludeBots, customRange, period, ...rest } = options ?? {};
    const response = await apiClient.get('/admin/users/analytics/new-users', {
        params: {
            ...rest,
            ...(customRange ? customRange : { period }),
            ...(excludeBots ? { bots: 'exclude' } : {})
        }
    });
    return response.data as { visitors: IVisitorOrigin[]; total: number };
}

/** Which subject a page-activity clickstream read keys on. */
export type PageActivitySubject = 'tid' | 'user';

/**
 * One row of a page-activity clickstream summary — a subject (an anonymous tid
 * or a registered account) with its `page`-event counts over the window. Only
 * interactive `page` events count; first-touch `bootstrap` rows are excluded,
 * so bots do not appear here.
 */
export interface IPageActivityRow {
    /** Subject key — the analytics tid (UUID) or the Better Auth user id. */
    id: string;
    firstSeen: string;
    lastSeen: string;
    pageViews: number;
    distinctPaths: number;
    firstPath: string | null;
    lastPath: string | null;
    country: string | null;
    device: string;
}

/** One page hit in a subject's clickstream drill-down. */
export interface IPageHit {
    timestamp: string;
    path: string;
    referer: string | null;
    device: string;
    country: string | null;
}

/**
 * Get the per-subject page-activity clickstream summary (admin endpoint).
 *
 * `'tid'` returns anonymous visitors keyed on the cookieless traffic id;
 * `'user'` returns registered accounts keyed on the Better Auth user id.
 * @param subject - `'tid'` (anonymous) or `'user'` (registered)
 * @param options - Period, pagination options
 * @returns Paginated activity rows plus the unpaginated subject total
 */
export async function adminGetPageActivity(subject: PageActivitySubject,
    options?: { period?: VisitorPeriod; customRange?: { startDate: string; endDate: string }; limit?: number; skip?: number }
): Promise<{ rows: IPageActivityRow[]; total: number }> {
    const endpoint = subject === 'tid'
        ? '/admin/users/analytics/tid-activity'
        : '/admin/users/analytics/user-activity';
    const { customRange, period, ...rest } = options ?? {};
    const response = await apiClient.get(endpoint, {
        params: { ...rest, ...(customRange ? customRange : { period }) }
    });
    return response.data as { rows: IPageActivityRow[]; total: number };
}

/**
 * Get the ordered page-hit clickstream for one subject (admin endpoint) —
 * every page the tid or account hit in the window, newest first.
 * @param subject - `'tid'` (anonymous) or `'user'` (registered)
 * @param id - The subject key (a UUID for `'tid'`, the user id for `'user'`)
 * @param options - Period, limit options
 * @returns The subject's page hits
 */
export async function adminGetPageHits(subject: PageActivitySubject,
    id: string,
    options?: { period?: VisitorPeriod; customRange?: { startDate: string; endDate: string }; limit?: number }
): Promise<IPageHit[]> {
    const { customRange, period, ...rest } = options ?? {};
    const response = await apiClient.get('/admin/users/analytics/page-hits', {
        params: { subject, id, ...rest, ...(customRange ? customRange : { period }) }
    });
    return (response.data as { data?: IPageHit[] }).data ?? [];
}

// ============================================================================
// Aggregate Analytics Types
// ============================================================================

/** Valid period options for aggregate analytics queries. */
export type AnalyticsPeriod = '24h' | '7d' | '30d' | '90d' | 'custom';

/** Custom date range parameters sent as ISO date strings. */
export interface ICustomDateRange {
    /** Start date ISO string (e.g. '2026-03-01T00:00:00.000Z'). */
    startDate: string;
    /** End date ISO string (e.g. '2026-03-15T23:59:59.999Z'). */
    endDate: string;
}

/** Traffic source entry in aggregate breakdown. Visitors is the primary measure. */
export interface ITrafficSource {
    source: string;
    category: string;
    /** Distinct visitors (tids) — the primary measure. */
    visitors: number;
    /** Raw event rows. */
    count: number;
    /** Share of total visitors (0-100, one decimal). */
    percentage: number;
}

/** GSC keyword data with full metrics from Google Search Console. */
export interface IGscKeyword {
    /** Search keyword */
    keyword: string;
    /** Total clicks */
    clicks: number;
    /** Total impressions */
    impressions: number;
    /** Average click-through rate (0-1) */
    ctr: number;
    /** Average position in search results */
    position: number;
}

/** Detailed breakdown for a single traffic source (drill-down). */
export interface ITrafficSourceDetails {
    source: string;
    visitors: number;
    landingPages: Array<{ path: string; count: number; percentage: number }>;
    countries: Array<{ country: string; count: number; percentage: number }>;
    devices: Array<{ device: string; count: number; percentage: number }>;
    utmCampaigns: Array<{ source: string; medium: string; campaign: string; count: number }>;
    searchKeywords: Array<{ keyword: string; count: number }>;
    gscKeywords?: IGscKeyword[];
    engagement: { avgSessions: number; avgPageViews: number; avgDuration: number };
    conversion: { walletsConnected: number; walletsVerified: number; conversionRate: number };
}

/** Landing page entry with engagement metrics. */
export interface ILandingPage {
    path: string;
    visitors: number;
    avgSessions: number;
    avgPageViews: number;
}

/** Country entry in geographic distribution. Visitors is the primary measure. */
export interface IGeoEntry {
    country: string;
    /** Distinct visitors (tids) — the primary measure. */
    count: number;
    /** Share of total visitors (0-100, one decimal). */
    percentage: number;
}

/** Device category entry. Visitors is the primary measure. */
export interface IDeviceEntry {
    device: string;
    /** Distinct visitors (tids) — the primary measure. */
    count: number;
    /** Share of total visitors (0-100, one decimal). */
    percentage: number;
}

/** Screen size category entry. */
export interface IScreenSizeEntry {
    screenSize: string;
    count: number;
    percentage: number;
}

/** UTM campaign performance entry. */
export interface ICampaignEntry {
    source: string;
    medium: string;
    campaign: string;
    visitors: number;
    walletsConnected: number;
    walletsVerified: number;
    conversionRate: number;
}

/** Engagement metrics summary. */
export interface IEngagementMetrics {
    avgSessionDuration: number;
    avgPagesPerSession: number;
    bounceRate: number;
    avgSessionsPerUser: number;
    totalUsers: number;
}

/** Conversion funnel stage. */
export interface IFunnelStage {
    stage: string;
    count: number;
    percentage: number;
    dropOff: number;
}

/** Daily new vs returning visitor entry. */
export interface IRetentionEntry {
    date: string;
    newVisitors: number;
    returningVisitors: number;
}

/**
 * Categorize a referrer domain into a coarse traffic-source bucket for the
 * dashboard badge. The ClickHouse `traffic_events` store only carries the raw
 * referrer domain (or `'direct'`), so the category is derived client-side.
 *
 * @param source - Referrer domain or `'direct'`.
 * @returns One of `'direct' | 'organic' | 'social' | 'referral'`.
 */
function categorizeTrafficSource(source: string): string {
    if (!source || source === 'direct') return 'direct';
    const s = source.toLowerCase();
    if (/(google|bing|duckduckgo|yahoo|baidu|yandex|ecosia)\./.test(s)) return 'organic';
    if (/(twitter|x\.com|t\.co|facebook|fb\.com|reddit|linkedin|instagram|youtube|tiktok|telegram|t\.me)/.test(s)) return 'social';
    return 'referral';
}

// ============================================================================
// Aggregate Analytics API Functions
// ============================================================================

/**
 * Get aggregate traffic source breakdown (admin endpoint).
 * @param period - Lookback period (default: '30d')
 * @param customRange - Custom date range overriding the period
 * @param excludeBots - Restrict to human-classified rows
 * @returns Traffic sources with visitor counts and percentages
 */
export async function adminGetTrafficSources(period: AnalyticsPeriod = '30d',
    customRange?: ICustomDateRange,
    excludeBots?: boolean
): Promise<{ sources: ITrafficSource[]; total: number }> {
    const params = {
        ...(customRange ? customRange : { period }),
        ...(excludeBots ? { bots: 'exclude' } : {})
    };
    const response = await apiClient.get('/admin/users/analytics/traffic-sources', {
        params
    });
    // Backend returns { data: [{ source, visitors, count }] }. Derive the
    // category badge and percentage (of visitors) client-side.
    const rows = (response.data as { data?: Array<{ source: string; visitors: number; count: number }> }).data ?? [];
    const total = rows.reduce((sum, r) => sum + (r.visitors ?? 0), 0);
    const sources: ITrafficSource[] = rows.map(r => ({
        source: r.source,
        category: categorizeTrafficSource(r.source),
        visitors: r.visitors,
        count: r.count,
        percentage: total > 0 ? Math.round((r.visitors / total) * 1000) / 10 : 0
    }));
    return { sources, total };
}

/**
 * Get detailed breakdown for a specific traffic source (admin endpoint).
 *
 * Returns landing pages, countries, devices, UTM campaigns, search keywords,
 * engagement metrics, and conversion rates for visitors from the given source.
 * @param source - Referrer domain (e.g. 'duckduckgo.com') or 'direct'
 * @param period - Lookback period (default: '30d')
 * @param customRange - Custom date range overriding the period
 * @param excludeBots - Restrict to human-classified rows
 * @returns Detailed source breakdown
 */
export async function adminGetTrafficSourceDetails(source: string,
    period: AnalyticsPeriod = '30d',
    customRange?: ICustomDateRange,
    excludeBots?: boolean
): Promise<ITrafficSourceDetails> {
    const params = {
        source,
        ...(customRange ? customRange : { period }),
        ...(excludeBots ? { bots: 'exclude' } : {})
    };
    const response = await apiClient.get('/admin/users/analytics/traffic-source-details', {
        params
    });
    return response.data as ITrafficSourceDetails;
}

/**
 * Get top landing pages by visitor count (admin endpoint).
 * @param options - Period, limit, and bot-filter options
 * @returns Landing pages with engagement metrics
 */
export async function adminGetTopLandingPages(options?: { period?: AnalyticsPeriod; limit?: number; customRange?: ICustomDateRange; excludeBots?: boolean }
): Promise<{ pages: ILandingPage[]; totalPages: number; totalVisitors: number }> {
    const { customRange, excludeBots, ...rest } = options ?? {};
    const params = {
        ...(customRange ? { ...customRange, limit: rest.limit } : rest),
        ...(excludeBots ? { bots: 'exclude' } : {})
    };
    const response = await apiClient.get('/admin/users/analytics/top-landing-pages', {
        params
    });
    // Backend returns { data: [{ path, visitors, count }] }. Per-page
    // session/view averages no longer exist (session events land
    // post-Phase-D), so they surface as 0.
    const rows = (response.data as { data?: Array<{ path: string; visitors: number; count: number }> }).data ?? [];
    const pages: ILandingPage[] = rows.map(r => ({ path: r.path, visitors: r.visitors, avgSessions: 0, avgPageViews: 0 }));
    return { pages, totalPages: pages.length, totalVisitors: rows.reduce((sum, r) => sum + (r.visitors ?? 0), 0) };
}

/**
 * Get geographic distribution of visitors (admin endpoint).
 * @param options - Period, limit, and bot-filter options
 * @returns Country distribution with visitor counts
 */
export async function adminGetGeoDistribution(options?: { period?: AnalyticsPeriod; limit?: number; customRange?: ICustomDateRange; excludeBots?: boolean }
): Promise<{ countries: IGeoEntry[]; total: number }> {
    const { customRange, excludeBots, ...rest } = options ?? {};
    const params = {
        ...(customRange ? { ...customRange, limit: rest.limit } : rest),
        ...(excludeBots ? { bots: 'exclude' } : {})
    };
    const response = await apiClient.get('/admin/users/analytics/geo-distribution', {
        params
    });
    // Backend returns { data: [{ country, visitors, count }] }; visitors is
    // the primary measure; derive percentage from it.
    const rows = (response.data as { data?: Array<{ country: string | null; visitors: number; count: number }> }).data ?? [];
    const total = rows.reduce((sum, r) => sum + (r.visitors ?? 0), 0);
    const countries: IGeoEntry[] = rows.map(r => ({
        country: r.country ?? 'Unknown',
        count: r.visitors,
        percentage: total > 0 ? Math.round((r.visitors / total) * 1000) / 10 : 0
    }));
    return { countries, total };
}

/**
 * Get device and screen size breakdown (admin endpoint).
 * @param period - Lookback period (default: '30d')
 * @param customRange - Custom date range overriding the period
 * @param excludeBots - Restrict to human-classified rows
 * @returns Device and screen size distributions
 */
export async function adminGetDeviceBreakdown(period: AnalyticsPeriod = '30d',
    customRange?: ICustomDateRange,
    excludeBots?: boolean
): Promise<{ devices: IDeviceEntry[]; screenSizes: IScreenSizeEntry[]; total: number }> {
    const params = {
        ...(customRange ? customRange : { period }),
        ...(excludeBots ? { bots: 'exclude' } : {})
    };
    const response = await apiClient.get('/admin/users/analytics/device-breakdown', {
        params
    });
    // Backend returns { data: [{ device, visitors, count }] }; visitors is the
    // primary measure. Screen-size dimension was dropped in the re-platform.
    const rows = (response.data as { data?: Array<{ device: string; visitors: number; count: number }> }).data ?? [];
    const total = rows.reduce((sum, r) => sum + (r.visitors ?? 0), 0);
    const devices: IDeviceEntry[] = rows.map(r => ({
        device: r.device,
        count: r.visitors,
        percentage: total > 0 ? Math.round((r.visitors / total) * 1000) / 10 : 0
    }));
    return { devices, screenSizes: [], total };
}

/**
 * Get UTM campaign performance (admin endpoint).
 * @param options - Period and limit options
 * @returns Campaign entries with conversion rates
 */
export async function adminGetCampaignPerformance(options?: { period?: AnalyticsPeriod; limit?: number; customRange?: ICustomDateRange; excludeBots?: boolean }
): Promise<{ campaigns: ICampaignEntry[]; total: number }> {
    const { customRange, excludeBots, ...rest } = options ?? {};
    const params = {
        ...(customRange ? { ...customRange, limit: rest.limit } : rest),
        ...(excludeBots ? { bots: 'exclude' } : {})
    };
    const response = await apiClient.get('/admin/users/analytics/campaign-performance', {
        params
    });
    // Backend returns { data: [{ campaign, source, medium, visitors,
    // conversions, conversionRate }] }. The legacy wallet-connected/-verified
    // split collapses to a single binary conversion (BA login).
    const rows = (response.data as {
        data?: Array<{ campaign: string; source: string; medium: string; visitors: number; conversions: number; conversionRate: number }>
    }).data ?? [];
    const campaigns: ICampaignEntry[] = rows.map(r => ({
        source: r.source,
        medium: r.medium,
        campaign: r.campaign,
        visitors: r.visitors,
        walletsConnected: r.conversions,
        walletsVerified: r.conversions,
        conversionRate: Math.round((r.conversionRate ?? 0) * 100)
    }));
    return { campaigns, total: campaigns.length };
}

/**
 * Get engagement metrics (admin endpoint).
 * @param period - Lookback period (default: '30d')
 * @returns Engagement summary (avg duration, pages/session, bounce rate)
 */
export async function adminGetEngagement(period: AnalyticsPeriod = '30d',
    customRange?: ICustomDateRange,
    excludeBots?: boolean
): Promise<IEngagementMetrics> {
    const params = {
        ...(customRange ? customRange : { period }),
        ...(excludeBots ? { bots: 'exclude' } : {})
    };
    const response = await apiClient.get('/admin/users/analytics/engagement', {
        params
    });
    // Backend returns { sessions, avgDurationMs, pagesPerSession, bounceRate
    // (0-1) }. Convert to the dashboard's seconds + percentage shape. Reads
    // near zero until Phase D wires session-event emission.
    const d = response.data as { sessions: number; avgDurationMs: number; pagesPerSession: number; bounceRate: number };
    return {
        avgSessionDuration: Math.round((d.avgDurationMs ?? 0) / 1000),
        avgPagesPerSession: Math.round((d.pagesPerSession ?? 0) * 10) / 10,
        bounceRate: Math.round((d.bounceRate ?? 0) * 100),
        avgSessionsPerUser: 0,
        totalUsers: d.sessions ?? 0
    };
}

/**
 * Get conversion funnel (admin endpoint).
 * @param period - Lookback period (default: '30d')
 * @returns Funnel stages with drop-off percentages
 */
export async function adminGetConversionFunnel(period: AnalyticsPeriod = '30d',
    customRange?: ICustomDateRange,
    excludeBots?: boolean
): Promise<{ stages: IFunnelStage[] }> {
    const params = {
        ...(customRange ? customRange : { period }),
        ...(excludeBots ? { bots: 'exclude' } : {})
    };
    const response = await apiClient.get('/admin/users/analytics/conversion-funnel', {
        params
    });
    // Backend returns the binary funnel { distinctVisitors, converted,
    // conversionRate (0-1) }. Render as two stages (visitors → logged in);
    // the legacy four-stage wallet/verified shape is retired.
    const d = response.data as { distinctVisitors: number; converted: number; conversionRate: number };
    const visitors = d.distinctVisitors ?? 0;
    const converted = d.converted ?? 0;
    const convPct = Math.round((d.conversionRate ?? 0) * 100);
    return {
        stages: [
            { stage: 'Visitors', count: visitors, percentage: 100, dropOff: 0 },
            { stage: 'Logged In', count: converted, percentage: convPct, dropOff: 100 - convPct }
        ]
    };
}

/**
 * Get new vs returning visitor retention data (admin endpoint).
 * @param period - Lookback period (default: '30d')
 * @returns Daily new vs returning visitor counts
 */
export async function adminGetRetention(period: AnalyticsPeriod = '30d',
    customRange?: ICustomDateRange,
    excludeBots?: boolean
): Promise<{ data: IRetentionEntry[] }> {
    const params = {
        ...(customRange ? customRange : { period }),
        ...(excludeBots ? { bots: 'exclude' } : {})
    };
    const response = await apiClient.get('/admin/users/analytics/retention', {
        params
    });
    // Backend returns { data: [{ day, newVisitors, returningVisitors }] };
    // the component keys retention rows on `date`.
    const rows = (response.data as { data?: Array<{ day: string; newVisitors: number; returningVisitors: number }> }).data ?? [];
    return { data: rows.map(r => ({ date: r.day, newVisitors: r.newVisitors, returningVisitors: r.returningVisitors })) };
}

/** Headline KPIs for one window of the overview trend. */
export interface IOverviewKpis {
    /** Distinct visitors (tids). */
    visitors: number;
    /** Interactive `page` events. */
    pageviews: number;
    /** `session_start` events — 0 until session instrumentation ships. */
    sessions: number;
    /** Average session duration in ms — 0 until session instrumentation ships. */
    avgDurationMs: number;
    /** Bounced sessions / sessions (0-1) — 0 until session instrumentation ships. */
    bounceRate: number;
}

/** One time bucket of the overview trend series. */
export interface IOverviewTrendPoint {
    /** Bucket start — ISO-8601 UTC for hours, `YYYY-MM-DD` for days. */
    bucket: string;
    visitors: number;
    pageviews: number;
}

/** Unified dashboard headline: KPIs + previous window + zero-filled series. */
export interface IOverviewTrend {
    granularity: 'hour' | 'day';
    current: IOverviewKpis;
    previous: IOverviewKpis;
    series: IOverviewTrendPoint[];
}

/**
 * Get the unified overview trend (admin endpoint): current/previous-window
 * KPIs for delta rendering plus the zero-filled visitors/pageviews series.
 * @param period - Lookback period (default: '30d')
 * @param customRange - Custom date range overriding the period
 * @param excludeBots - Restrict to human-classified rows
 * @returns Granularity, both KPI windows, and the bucket series
 */
export async function adminGetOverviewTrend(period: AnalyticsPeriod = '30d',
    customRange?: ICustomDateRange,
    excludeBots?: boolean
): Promise<IOverviewTrend> {
    const params = {
        ...(customRange ? customRange : { period }),
        ...(excludeBots ? { bots: 'exclude' } : {})
    };
    const response = await apiClient.get('/admin/users/analytics/overview-trend', {
        params
    });
    return response.data as IOverviewTrend;
}

/**
 * Get the count of visitors active in the last five minutes (admin endpoint).
 * @param excludeBots - Restrict to human-classified rows
 * @returns Live visitor count and the window size
 */
export async function adminGetLiveVisitors(excludeBots?: boolean
): Promise<{ visitors: number; windowMinutes: number }> {
    const response = await apiClient.get('/admin/users/analytics/live', {
        params: excludeBots ? { bots: 'exclude' } : {}
    });
    const d = response.data as { visitors?: number; windowMinutes?: number };
    return { visitors: d.visitors ?? 0, windowMinutes: d.windowMinutes ?? 5 };
}

/** Better Auth account overview for the analytics dashboard. */
export interface IAnalyticsOverview {
    /** Total Better Auth accounts. */
    totalAccounts: number;
    /** Accounts with at least one linked wallet. */
    accountsWithWallets: number;
    /** Wallet-adoption rate as a 0-1 fraction. */
    walletAdoptionRate: number;
}

/**
 * Get the Better Auth account overview (admin endpoint): total accounts and
 * the wallet-adoption rate. Not time-windowed.
 * @returns Account count and wallet-adoption metrics.
 */
export async function adminGetAnalyticsOverview(): Promise<IAnalyticsOverview> {
    const response = await apiClient.get('/admin/users/analytics/overview');
    const d = response.data as Partial<IAnalyticsOverview>;
    return {
        totalAccounts: d.totalAccounts ?? 0,
        accountsWithWallets: d.accountsWithWallets ?? 0,
        walletAdoptionRate: d.walletAdoptionRate ?? 0
    };
}

// ============================================================================
// Google Search Console API Functions
// ============================================================================

/** GSC configuration status. */
export interface IGscStatus {
    /** Whether GSC credentials are configured */
    configured: boolean;
    /** GSC property URL */
    siteUrl?: string;
    /** Timestamp of last successful data fetch */
    lastFetch?: string;
}

/**
 * Get GSC configuration status (admin endpoint).
 * @returns GSC configuration status
 */
export async function adminGetGscStatus(): Promise<IGscStatus> {
    const response = await apiClient.get('/admin/users/analytics/gsc/status');
    return response.data as IGscStatus;
}

/**
 * Save GSC service account credentials (admin endpoint).
 *
 * Validates the JSON key and tests API access before saving.
 * @param serviceAccountJson - JSON string of Google service account key
 * @param siteUrl - GSC property URL (e.g., "https://tronrelic.com")
 * @returns Updated GSC status
 */
export async function adminSaveGscCredentials(serviceAccountJson: string,
    siteUrl: string
): Promise<IGscStatus> {
    const response = await apiClient.post(
        '/admin/users/analytics/gsc/credentials',
        { serviceAccountJson, siteUrl }
    );
    return response.data as IGscStatus;
}

/**
 * Remove stored GSC credentials (admin endpoint).
 * */
export async function adminRemoveGscCredentials(): Promise<void> {
    await apiClient.delete('/admin/users/analytics/gsc/credentials');
}

/**
 * Trigger on-demand GSC data fetch (admin endpoint).
 * @returns Number of rows fetched from GSC API
 */
export async function adminRefreshGscData(): Promise<{ rowsFetched: number }> {
    const response = await apiClient.post(
        '/admin/users/analytics/gsc/refresh',
        {}
    );
    return response.data as { rowsFetched: number };
}

/** One day's per-keyword GSC bucket (clicks/impressions trend + top keywords). */
export interface IGscDailyKeywords {
    /** Calendar day in `YYYY-MM-DD` (already offset by the GSC ingestion delay). */
    date: string;
    totalClicks: number;
    totalImpressions: number;
    keywords: IGscKeyword[];
}

/**
 * Aggregated GSC keywords plus the delay-shifted window actually covered.
 * GSC data lags ~3 days, so "7d" covers the 7 days ending ~3 days ago —
 * `windowStart`/`windowEnd` carry the true dates for display.
 */
export interface IGscKeywordsResult {
    /** Inclusive window start (ISO-8601 UTC). */
    windowStart: string;
    /** Inclusive window end (ISO-8601 UTC). */
    windowEnd: string;
    /** Keywords sorted by clicks descending. */
    keywords: IGscKeyword[];
}

/**
 * Get aggregated GSC keywords for a lookback window (admin endpoint).
 * @param options - Window in hours (default 168 = 7d) and row limit
 * @returns Keywords sorted by clicks descending plus the covered window
 */
export async function adminGetGscKeywords(options?: { periodHours?: number; limit?: number }
): Promise<IGscKeywordsResult> {
    const response = await apiClient.get('/admin/users/analytics/gsc/keywords', {
        params: options
    });
    const data = response.data as Partial<IGscKeywordsResult>;
    return {
        windowStart: data.windowStart ?? '',
        windowEnd: data.windowEnd ?? '',
        keywords: data.keywords ?? []
    };
}

/**
 * Get daily GSC keyword buckets for trend charting (admin endpoint).
 * @param days - Number of daily buckets (default 14)
 * @param topN - Max keywords per bucket (default 15)
 * @returns Daily buckets oldest first
 */
export async function adminGetGscKeywordsByDay(days: number = 14,
    topN: number = 15
): Promise<IGscDailyKeywords[]> {
    const response = await apiClient.get('/admin/users/analytics/gsc/keywords-by-day', {
        params: { days, topN }
    });
    return (response.data as { buckets: IGscDailyKeywords[] }).buckets ?? [];
}

// ============================================================================
// Crawler Analytics API Functions
// ============================================================================

/** One bucket of a raw traffic aggregate (path/UA/country + row count). */
export interface ITrafficBucket {
    key: string | null;
    count: number;
}

/**
 * One day's per-bot-class row counts. `counts` is keyed by `bot_class`
 * (`human`, `search_engine`, `ai_crawler`, ...) with NULL rows folded into
 * `'unclassified'`.
 */
export interface IBotClassDailyPoint {
    /** Calendar day in `YYYY-MM-DD`. */
    day: string;
    /** Row count per bot class for the day. */
    counts: Record<string, number>;
}

/**
 * Get daily per-bot-class event counts for the crawler trend chart (admin
 * endpoint).
 * @param sinceHours - Lookback window in hours (default 168 = 7d)
 * @returns Daily points oldest first plus the ClickHouse availability flag
 */
export async function adminGetBotTrend(sinceHours: number = 168
): Promise<{ points: IBotClassDailyPoint[]; clickhouseEnabled: boolean }> {
    const response = await apiClient.get('/admin/users/traffic/bot-trend', {
        params: { sinceHours }
    });
    return response.data as { points: IBotClassDailyPoint[]; clickhouseEnabled: boolean };
}

/**
 * Get the top paths hit by one bot class (admin endpoint) — "which pages do
 * AI crawlers actually fetch".
 * @param botClass - Bot class to filter on (e.g. `'ai_crawler'`)
 * @param options - Lookback window and row limit
 * @returns Path buckets ordered by hit count
 */
export async function adminGetBotPaths(botClass: string,
    options?: { sinceHours?: number; limit?: number }
): Promise<{ buckets: ITrafficBucket[]; clickhouseEnabled: boolean }> {
    const response = await apiClient.get('/admin/users/traffic/bot-paths', {
        params: { botClass, ...options }
    });
    return response.data as { buckets: ITrafficBucket[]; clickhouseEnabled: boolean };
}
