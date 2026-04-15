/**
 * User service interface for plugin consumption.
 *
 * Provides read-only access to user data that plugins can use for:
 * - Checking if a user has verified wallets (registered user)
 * - Looking up users by ID or wallet address
 * - Accessing user preferences for plugin-specific settings
 * - Querying aggregate user statistics for health monitoring
 *
 * The concrete UserService implementation handles caching, wallet verification,
 * and activity tracking internally. Plugins receive this interface via
 * IPluginContext.userService dependency injection, or discover it on the
 * service registry via `context.services.get<IUserService>('user')`.
 *
 * @module @/types/user
 */

import type { IUser } from './IUser.js';

/**
 * Duration string for analytics bucketing.
 *
 * Combines a numeric amount with a time unit to define bucket width.
 * Examples: '1h' (one hour), '4h' (four hours), '1d' (one day).
 */
export type BucketInterval = `${number}h` | `${number}d`;

/**
 * Aggregate user activity metrics for health monitoring.
 *
 * Combines user counts, engagement metrics, and daily visitor trends
 * into a single snapshot useful for admin dashboards and AI assistants.
 */
export interface IUserActivitySummary {
    /** Total registered users in the system. */
    totalUsers: number;
    /** Users with activity.lastSeen within the last 24 hours. */
    activeToday: number;
    /** Users with activity.lastSeen within the last 7 days. */
    activeThisWeek: number;
    /** Users with activity.firstSeen within the last 24 hours. */
    newUsersToday: number;
    /** Users with activity.firstSeen within the last 7 days. */
    newUsersThisWeek: number;
    /** Average session duration in seconds across recent sessions. */
    avgSessionDuration: number;
    /** Average pages viewed per session. */
    avgPagesPerSession: number;
    /** Percentage of sessions with one or fewer page views. */
    bounceRate: number;
    /** Daily unique visitor counts for the last 7 days. */
    dailyTrend: Array<{ date: string; count: number }>;
}

/**
 * Wallet linking statistics for health monitoring.
 *
 * Tracks wallet adoption, verification rates, and conversion funnel
 * from anonymous visitor to verified wallet holder.
 */
export interface IUserWalletSummary {
    /** Total wallet links across all users. */
    totalWalletLinks: number;
    /** Users with at least one wallet linked. */
    usersWithWallets: number;
    /** Users with no wallets linked. */
    usersWithoutWallets: number;
    /** Users with two or more wallets linked. */
    usersWithMultipleWallets: number;
    /** Average number of wallets per user (total links / total users). */
    averageWalletsPerUser: number;
    /** Wallets with cryptographic signature verification. */
    verifiedWallets: number;
    /** Wallets connected but not yet verified. */
    unverifiedWallets: number;
    /** Wallets linked within the last 24 hours. */
    walletsLinkedToday: number;
    /** Wallets linked within the last 7 days. */
    walletsLinkedThisWeek: number;
    /** Conversion funnel: visitor → return visitor → wallet connected → wallet verified. */
    conversionFunnel: Array<{ stage: string; count: number; percentage: number }>;
}

/**
 * User retention metrics for health monitoring.
 *
 * Provides new vs returning visitor breakdown, dormant user counts,
 * and daily retention trends.
 */
export interface IUserRetentionSummary {
    /** Users whose first visit was today. */
    newUsersToday: number;
    /** Users active today who first visited before today. */
    returningUsersToday: number;
    /** Users with lastSeen > 30 days ago but lifetime pageViews > 10. */
    dormantUsers: number;
    /** Daily new vs returning visitor breakdown for the last 7 days. */
    dailyRetention: Array<{ date: string; newVisitors: number; returningVisitors: number }>;
}

/**
 * A single page path with its view count within a daily bucket.
 */
export interface IPageTrafficEntry {
    /** URL path (e.g., '/markets', '/accounts/TXyz...'). */
    path: string;
    /** Total page views for this path within the bucket's day. */
    views: number;
}

/**
 * One day's page traffic breakdown.
 *
 * Contains the top paths ranked by view count plus an aggregate
 * "other" count for all remaining paths that fell outside the top N.
 */
export interface IPageTrafficBucket {
    /** Bucket start timestamp (YYYY-MM-DD for daily, YYYY-MM-DDTHH:00 for hourly). */
    date: string;
    /** Total page views across all paths for this bucket. */
    totalViews: number;
    /** Top paths ranked by view count (capped at the requested limit). */
    topPaths: IPageTrafficEntry[];
    /** Aggregate view count for all paths not included in topPaths. */
    otherViews: number;
}

/**
 * Page traffic history broken into time-interval buckets.
 *
 * Each bucket contains the top paths for that interval, enabling
 * trend analysis of which pages gain or lose traffic over time.
 */
export interface IPageTrafficHistory {
    /** @deprecated Use bucketCount instead. */
    days: number;
    /** Number of time-interval buckets returned. */
    bucketCount: number;
    /** Interval used for bucketing (e.g., '1h', '1d'). */
    bucketInterval: BucketInterval;
    /** Traffic buckets ordered chronologically (oldest first). */
    buckets: IPageTrafficBucket[];
}

/**
 * A single recent page view event with user and timestamp context.
 */
export interface IRecentPageView {
    /** ISO 8601 timestamp of the page view. */
    timestamp: string;
    /** UUID of the user who viewed the page. */
    userId: string;
    /** URL path that was viewed. */
    path: string;
}

/**
 * Recent individual page view events for the last 24 hours.
 *
 * Provides a reverse-chronological stream of raw page view
 * activity for real-time situational awareness.
 */
export interface IRecentPageViewsResult {
    /** Number of page view events returned (up to the requested limit). */
    count: number;
    /** Individual page view events, most recent first. */
    views: IRecentPageView[];
}

/**
 * A single entry in a daily traffic source bucket.
 */
export interface IDailyTrafficSourceEntry {
    /** Referrer domain (or 'direct' for no referrer). */
    source: string;
    /** Traffic category (direct, organic, social, referral). */
    category: 'direct' | 'organic' | 'social' | 'referral';
    /** Number of unique visitors from this source on this day. */
    count: number;
}

/**
 * One day's traffic source breakdown.
 */
export interface IDailyTrafficSourceBucket {
    /** Bucket start timestamp (YYYY-MM-DD for daily, YYYY-MM-DDTHH:00 for hourly). */
    date: string;
    /** Total unique visitors for this bucket. */
    totalVisitors: number;
    /** Top sources ranked by visitor count. */
    sources: IDailyTrafficSourceEntry[];
}

/**
 * Traffic source history with optional GSC keyword data.
 */
export interface ITrafficSourcesHistory {
    /** @deprecated Use bucketCount instead. */
    days: number;
    /** Number of time-interval buckets returned. */
    bucketCount: number;
    /** Interval used for bucketing (e.g., '1h', '1d'). */
    bucketInterval: BucketInterval;
    /** Traffic source buckets ordered chronologically. */
    buckets: IDailyTrafficSourceBucket[];
    /** GSC keyword data per day (may be sparse due to 3-day delay). */
    keywords: Array<{
        date: string;
        totalClicks: number;
        totalImpressions: number;
        keywords: Array<{ keyword: string; clicks: number; impressions: number; ctr: number; position: number }>;
    }>;
}

/**
 * A single entry in a daily geo distribution bucket.
 */
export interface IDailyGeoEntry {
    /** ISO 3166-1 alpha-2 country code. */
    country: string;
    /** Number of unique visitors from this country on this day. */
    count: number;
}

/**
 * One day's geographic distribution breakdown.
 */
export interface IDailyGeoBucket {
    /** Bucket start timestamp (YYYY-MM-DD for daily, YYYY-MM-DDTHH:00 for hourly). */
    date: string;
    /** Total unique visitors for this bucket. */
    totalVisitors: number;
    /** Top countries ranked by visitor count. */
    countries: IDailyGeoEntry[];
}

/**
 * Geographic distribution history.
 */
export interface IGeoDistributionHistory {
    /** @deprecated Use bucketCount instead. */
    days: number;
    /** Number of time-interval buckets returned. */
    bucketCount: number;
    /** Interval used for bucketing (e.g., '1h', '1d'). */
    bucketInterval: BucketInterval;
    /** Geo buckets ordered chronologically. */
    buckets: IDailyGeoBucket[];
}

/**
 * One day's device breakdown.
 */
export interface IDailyDeviceBucket {
    /** Bucket start timestamp (YYYY-MM-DD for daily, YYYY-MM-DDTHH:00 for hourly). */
    date: string;
    /** Total sessions for this bucket. */
    totalSessions: number;
    /** Device category counts for this bucket. */
    devices: Array<{ device: string; count: number }>;
}

/**
 * Device breakdown history.
 */
export interface IDeviceBreakdownHistory {
    /** @deprecated Use bucketCount instead. */
    days: number;
    /** Number of time-interval buckets returned. */
    bucketCount: number;
    /** Interval used for bucketing (e.g., '1h', '1d'). */
    bucketInterval: BucketInterval;
    /** Device buckets ordered chronologically. */
    buckets: IDailyDeviceBucket[];
}

/**
 * A single entry in a daily landing page bucket.
 */
export interface IDailyLandingPageEntry {
    /** URL path of the landing page. */
    path: string;
    /** Number of sessions that started on this page. */
    entries: number;
    /** Number of single-page sessions (bounce). */
    bounces: number;
}

/**
 * One day's landing page breakdown.
 */
export interface IDailyLandingPageBucket {
    /** Bucket start timestamp (YYYY-MM-DD for daily, YYYY-MM-DDTHH:00 for hourly). */
    date: string;
    /** Total sessions for this bucket. */
    totalSessions: number;
    /** Top landing pages ranked by entry count. */
    pages: IDailyLandingPageEntry[];
}

/**
 * Landing page history.
 */
export interface ILandingPagesHistory {
    /** @deprecated Use bucketCount instead. */
    days: number;
    /** Number of time-interval buckets returned. */
    bucketCount: number;
    /** Interval used for bucketing (e.g., '1h', '1d'). */
    bucketInterval: BucketInterval;
    /** Landing page buckets ordered chronologically. */
    buckets: IDailyLandingPageBucket[];
}

/**
 * A single entry in a daily campaign bucket.
 */
export interface IDailyCampaignEntry {
    /** UTM source. */
    source: string;
    /** UTM medium. */
    medium: string;
    /** UTM campaign name. */
    campaign: string;
    /** Number of visitors from this campaign. */
    visitors: number;
}

/**
 * One day's UTM campaign breakdown.
 */
export interface IDailyCampaignBucket {
    /** Bucket start timestamp (YYYY-MM-DD for daily, YYYY-MM-DDTHH:00 for hourly). */
    date: string;
    /** Total UTM-tagged visitors for this bucket. */
    totalVisitors: number;
    /** Top campaigns ranked by visitor count. */
    campaigns: IDailyCampaignEntry[];
}

/**
 * Campaign performance history.
 */
export interface ICampaignPerformanceHistory {
    /** @deprecated Use bucketCount instead. */
    days: number;
    /** Number of time-interval buckets returned. */
    bucketCount: number;
    /** Interval used for bucketing (e.g., '1h', '1d'). */
    bucketInterval: BucketInterval;
    /** Campaign buckets ordered chronologically. */
    buckets: IDailyCampaignBucket[];
}

/**
 * One day's session duration distribution.
 */
export interface IDailySessionDurationBucket {
    /** Bucket start timestamp (YYYY-MM-DD for daily, YYYY-MM-DDTHH:00 for hourly). */
    date: string;
    /** Total sessions for this bucket. */
    totalSessions: number;
    /** Sessions lasting 0-10 seconds (likely bounces). */
    under10s: number;
    /** Sessions lasting 10-60 seconds. */
    s10to60: number;
    /** Sessions lasting 1-5 minutes. */
    m1to5: number;
    /** Sessions lasting 5-15 minutes. */
    m5to15: number;
    /** Sessions lasting 15+ minutes. */
    over15m: number;
}

/**
 * Session duration distribution history.
 */
export interface ISessionDurationHistory {
    /** @deprecated Use bucketCount instead. */
    days: number;
    /** Number of time-interval buckets returned. */
    bucketCount: number;
    /** Interval used for bucketing (e.g., '1h', '1d'). */
    bucketInterval: BucketInterval;
    /** Session duration buckets ordered chronologically. */
    buckets: IDailySessionDurationBucket[];
}

/**
 * One day's pages-per-session distribution.
 */
export interface IDailyPagesPerSessionBucket {
    /** Bucket start timestamp (YYYY-MM-DD for daily, YYYY-MM-DDTHH:00 for hourly). */
    date: string;
    /** Total sessions for this bucket. */
    totalSessions: number;
    /** Sessions with exactly 1 page view (bounce). */
    onePage: number;
    /** Sessions with 2-3 page views. */
    twoToThree: number;
    /** Sessions with 4-6 page views. */
    fourToSix: number;
    /** Sessions with 7+ page views. */
    sevenPlus: number;
}

/**
 * Pages-per-session distribution history.
 */
export interface IPagesPerSessionHistory {
    /** @deprecated Use bucketCount instead. */
    days: number;
    /** Number of time-interval buckets returned. */
    bucketCount: number;
    /** Interval used for bucketing (e.g., '1h', '1d'). */
    bucketInterval: BucketInterval;
    /** Pages-per-session buckets ordered chronologically. */
    buckets: IDailyPagesPerSessionBucket[];
}

/**
 * One day's new vs returning visitor breakdown.
 */
export interface IDailyNewVsReturningBucket {
    /** Bucket start timestamp (YYYY-MM-DD for daily, YYYY-MM-DDTHH:00 for hourly). */
    date: string;
    /** Total unique visitors for this bucket. */
    totalVisitors: number;
    /** Visitors whose first session was in this bucket. */
    newVisitors: number;
    /** Visitors who had sessions before this bucket. */
    returningVisitors: number;
}

/**
 * New vs returning visitor history.
 */
export interface INewVsReturningHistory {
    /** @deprecated Use bucketCount instead. */
    days: number;
    /** Number of time-interval buckets returned. */
    bucketCount: number;
    /** Interval used for bucketing (e.g., '1h', '1d'). */
    bucketInterval: BucketInterval;
    /** New vs returning buckets ordered chronologically. */
    buckets: IDailyNewVsReturningBucket[];
}

/**
 * One day's wallet conversion funnel.
 */
export interface IDailyWalletConversionBucket {
    /** Bucket start timestamp (YYYY-MM-DD for daily, YYYY-MM-DDTHH:00 for hourly). */
    date: string;
    /** Total unique visitors for this bucket. */
    totalVisitors: number;
    /** Visitors with at least one wallet connected (verified or not). */
    walletsConnected: number;
    /** Visitors with at least one cryptographically verified wallet. */
    walletsVerified: number;
}

/**
 * Wallet conversion funnel history.
 */
export interface IWalletConversionHistory {
    /** @deprecated Use bucketCount instead. */
    days: number;
    /** Number of time-interval buckets returned. */
    bucketCount: number;
    /** Interval used for bucketing (e.g., '1h', '1d'). */
    bucketInterval: BucketInterval;
    /** Wallet conversion buckets ordered chronologically. */
    buckets: IDailyWalletConversionBucket[];
}

/**
 * A single entry in a daily exit page bucket.
 */
export interface IDailyExitPageEntry {
    /** URL path of the last page viewed in the session. */
    path: string;
    /** Number of sessions that ended on this page. */
    exits: number;
}

/**
 * One day's exit page breakdown.
 */
export interface IDailyExitPageBucket {
    /** Bucket start timestamp (YYYY-MM-DD for daily, YYYY-MM-DDTHH:00 for hourly). */
    date: string;
    /** Total sessions for this bucket. */
    totalSessions: number;
    /** Top exit pages ranked by exit count. */
    pages: IDailyExitPageEntry[];
}

/**
 * Exit page history.
 */
export interface IExitPagesHistory {
    /** @deprecated Use bucketCount instead. */
    days: number;
    /** Number of time-interval buckets returned. */
    bucketCount: number;
    /** Interval used for bucketing (e.g., '1h', '1d'). */
    bucketInterval: BucketInterval;
    /** Exit page buckets ordered chronologically. */
    buckets: IDailyExitPageBucket[];
}

/**
 * User preference distribution for health monitoring.
 *
 * Aggregates theme choices and notification opt-in rates
 * across the user base.
 */
export interface IUserPreferencesSummary {
    /** Count of users per theme UUID (or 'unset' for no preference). */
    themeDistribution: Record<string, number>;
    /** Percentage of users who opted into notifications. */
    notificationOptInRate: number;
    /** Number of users who have set at least one preference. */
    totalWithPreferences: number;
}

/**
 * User service interface exposed to plugins.
 *
 * Provides read-only methods for accessing user identity data and
 * aggregate statistics. Plugins should not modify user data directly —
 * use plugin-specific storage or coordinate with the user module for updates.
 *
 * Note: For HTTP route handlers, user context is automatically available
 * via `req.userId` and `req.user` (populated by middleware). Use IUserService
 * for non-request contexts like observers or scheduled jobs.
 *
 * @example
 * ```typescript
 * // In plugin observer - look up user by wallet address
 * async init(context: IPluginContext) {
 *     const { userService, logger } = context;
 *
 *     class TransferObserver extends context.BaseObserver {
 *         protected readonly name = 'TransferObserver';
 *
 *         protected async process(transaction: ITransaction): Promise<void> {
 *             const fromAddress = transaction.payload.from.address;
 *             const user = await userService.getByWallet(fromAddress);
 *
 *             if (user) {
 *                 const hasVerifiedWallet = user.wallets?.some(w => w.verified);
 *                 logger.info({ userId: user.id, hasVerifiedWallet },
 *                     'Transaction from known user');
 *             }
 *         }
 *     }
 *
 *     context.observerRegistry.subscribeTransactionType(
 *         'TransferContract',
 *         new TransferObserver()
 *     );
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Discover via service registry for aggregate stats
 * const userService = context.services.get<IUserService>('user');
 * if (userService) {
 *     const activity = await userService.getActivitySummary();
 *     context.logger.info({ activeToday: activity.activeToday }, 'User activity snapshot');
 * }
 * ```
 */
export interface IUserService {
    /**
     * Get a user by UUID.
     *
     * Returns cached user if available, otherwise fetches from database.
     * Returns null if UUID is invalid or user not found.
     *
     * @param id - UUID v4 identifier
     * @returns User data or null if not found
     */
    getById(id: string): Promise<IUser | null>;

    /**
     * Get a user by linked wallet address.
     *
     * Useful for reverse lookups when you know the wallet but not the UUID.
     * Handles TRON address normalization internally.
     *
     * @param address - Base58 TRON address
     * @returns User data or null if no user has this wallet linked
     */
    getByWallet(address: string): Promise<IUser | null>;

    /**
     * Get aggregate user activity metrics.
     *
     * Combines user counts, engagement stats, and a 7-day daily visitor
     * trend into a single snapshot for health monitoring.
     *
     * @returns Activity summary with counts, engagement, and trends
     */
    getActivitySummary(): Promise<IUserActivitySummary>;

    /**
     * Get wallet linking statistics.
     *
     * Tracks adoption rates, verification progress, and the conversion
     * funnel from anonymous visitor to verified wallet holder.
     *
     * @returns Wallet summary with counts, rates, and funnel stages
     */
    getWalletSummary(): Promise<IUserWalletSummary>;

    /**
     * Get user retention metrics.
     *
     * Provides new vs returning visitor breakdown, dormant user detection,
     * and a 7-day daily retention trend.
     *
     * @returns Retention summary with daily breakdown and dormant count
     */
    getRetentionSummary(): Promise<IUserRetentionSummary>;

    /**
     * Get user preference distribution.
     *
     * Aggregates theme choices and notification opt-in rates across
     * the user base for health monitoring and audience understanding.
     *
     * @returns Preference summary with theme distribution and opt-in rates
     */
    getPreferencesSummary(): Promise<IUserPreferencesSummary>;

    /**
     * Get page traffic history broken into time-interval buckets.
     *
     * Aggregates page views from user sessions, returning the top paths
     * per bucket with an "other" rollup for the rest.
     *
     * @param bucketInterval - Duration per bucket, e.g. '1h' or '1d' (default '1d')
     * @param bucketCount - Number of buckets to return (default 14)
     * @param topN - Number of top paths per bucket (default 30)
     * @returns Traffic buckets ordered chronologically
     */
    getPageTrafficHistory(bucketInterval?: BucketInterval, bucketCount?: number, topN?: number): Promise<IPageTrafficHistory>;

    /**
     * Get recent individual page view events.
     *
     * Returns a reverse-chronological stream of raw page view events
     * from user sessions within the specified time window.
     *
     * @param hours - How many hours back to query (default 24)
     * @param limit - Maximum events to return (default 500)
     * @returns Recent page view events, most recent first
     */
    getRecentPageViews(hours?: number, limit?: number): Promise<IRecentPageViewsResult>;

    /**
     * Get traffic sources broken into time-interval buckets with optional GSC keywords.
     *
     * @param bucketInterval - Duration per bucket (default '1d')
     * @param bucketCount - Number of buckets (default 14)
     * @param topN - Top sources per bucket (default 15)
     * @returns Traffic source buckets with GSC keyword data
     */
    getTrafficSourcesByDay(bucketInterval?: BucketInterval, bucketCount?: number, topN?: number): Promise<ITrafficSourcesHistory>;

    /**
     * Get geographic distribution broken into time-interval buckets.
     *
     * @param bucketInterval - Duration per bucket (default '1d')
     * @param bucketCount - Number of buckets (default 14)
     * @param topN - Top countries per bucket (default 20)
     * @returns Geo distribution buckets
     */
    getGeoDistributionByDay(bucketInterval?: BucketInterval, bucketCount?: number, topN?: number): Promise<IGeoDistributionHistory>;

    /**
     * Get device breakdown broken into time-interval buckets.
     *
     * @param bucketInterval - Duration per bucket (default '1d')
     * @param bucketCount - Number of buckets (default 14)
     * @returns Device breakdown buckets
     */
    getDeviceBreakdownByDay(bucketInterval?: BucketInterval, bucketCount?: number): Promise<IDeviceBreakdownHistory>;

    /**
     * Get landing page performance broken into time-interval buckets.
     *
     * @param bucketInterval - Duration per bucket (default '1d')
     * @param bucketCount - Number of buckets (default 14)
     * @param topN - Top landing pages per bucket (default 20)
     * @returns Landing page buckets with bounce rates
     */
    getLandingPagesByDay(bucketInterval?: BucketInterval, bucketCount?: number, topN?: number): Promise<ILandingPagesHistory>;

    /**
     * Get UTM campaign performance broken into time-interval buckets.
     *
     * @param bucketInterval - Duration per bucket (default '1d')
     * @param bucketCount - Number of buckets (default 14)
     * @param topN - Top campaigns per bucket (default 10)
     * @returns Campaign performance buckets
     */
    getCampaignPerformanceByDay(bucketInterval?: BucketInterval, bucketCount?: number, topN?: number): Promise<ICampaignPerformanceHistory>;

    /**
     * Get session duration distribution broken into time-interval buckets.
     *
     * @param bucketInterval - Duration per bucket (default '1d')
     * @param bucketCount - Number of buckets (default 14)
     * @returns Session duration distribution buckets
     */
    getSessionDurationByDay(bucketInterval?: BucketInterval, bucketCount?: number): Promise<ISessionDurationHistory>;

    /**
     * Get pages-per-session distribution broken into time-interval buckets.
     *
     * @param bucketInterval - Duration per bucket (default '1d')
     * @param bucketCount - Number of buckets (default 14)
     * @returns Pages-per-session distribution buckets
     */
    getPagesPerSessionByDay(bucketInterval?: BucketInterval, bucketCount?: number): Promise<IPagesPerSessionHistory>;

    /**
     * Get new vs returning visitor breakdown by time-interval bucket.
     *
     * @param bucketInterval - Duration per bucket (default '1d')
     * @param bucketCount - Number of buckets (default 14)
     * @returns New vs returning visitor buckets
     */
    getNewVsReturningByDay(bucketInterval?: BucketInterval, bucketCount?: number): Promise<INewVsReturningHistory>;

    /**
     * Get wallet conversion funnel broken into time-interval buckets.
     *
     * @param bucketInterval - Duration per bucket (default '1d')
     * @param bucketCount - Number of buckets (default 14)
     * @returns Wallet conversion funnel buckets
     */
    getWalletConversionByDay(bucketInterval?: BucketInterval, bucketCount?: number): Promise<IWalletConversionHistory>;

    /**
     * Get exit page performance broken into time-interval buckets.
     *
     * @param bucketInterval - Duration per bucket (default '1d')
     * @param bucketCount - Number of buckets (default 14)
     * @param topN - Top exit pages per bucket (default 20)
     * @returns Exit page buckets
     */
    getExitPagesByDay(bucketInterval?: BucketInterval, bucketCount?: number, topN?: number): Promise<IExitPagesHistory>;
}
