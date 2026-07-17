/**
 * Traffic module API barrel export.
 *
 * Surfaces the admin analytics, crawler, and Google Search Console client
 * used by the `/system/traffic` dashboards. The legacy UUID user/wallet/
 * session/profile/referral calls were removed in the Better Auth cutover.
 */

export {
    // Visitor analytics
    adminGetDailyVisitors,
    adminGetAnonymousFirstTouches,
    adminGetPageActivity,
    adminGetPageHits,
    // Aggregate analytics functions
    adminGetTrafficSources,
    adminGetTrafficSourceDetails,
    adminGetTopLandingPages,
    adminGetGeoDistribution,
    adminGetDeviceBreakdown,
    adminGetCampaignPerformance,
    adminGetEngagement,
    adminGetConversionFunnel,
    adminGetRetention,
    adminGetAnalyticsOverview,
    adminGetOverviewTrend,
    adminGetLiveVisitors,
    adminGetFlaggedSubnets,
    // Ignore-list functions
    adminGetIgnoredUsers,
    adminAddIgnoredUser,
    adminRemoveIgnoredUser,
    adminSearchAccounts,
    // Google Search Console functions
    adminGetGscStatus,
    adminSaveGscCredentials,
    adminRemoveGscCredentials,
    adminRefreshGscData,
    adminGetGscKeywords,
    adminGetGscPages,
    adminGetGscKeywordsByDay,
    // Crawler analytics functions
    adminGetBotTrend,
    adminGetBotPaths
} from './client';

export type {
    IDailyVisitorData,
    IVisitorOrigin,
    IUtmParams,
    IFlaggedSubnet,
    VisitorPeriod,
    PageActivitySubject,
    IPageActivityRow,
    IPageHit,
    // Aggregate analytics types
    AnalyticsPeriod,
    ICustomDateRange,
    ITrafficSource,
    ITrafficSourceDetails,
    ILandingPage,
    IGeoEntry,
    IDeviceEntry,
    IScreenSizeEntry,
    ICampaignEntry,
    IEngagementMetrics,
    IFunnelStage,
    IRetentionEntry,
    IAnalyticsOverview,
    IOverviewKpis,
    IOverviewTrendPath,
    IOverviewTrendCountry,
    IOverviewTrendSource,
    IOverviewTrendPoint,
    IOverviewTrend,
    IIgnoredUser,
    IAccountMatch,
    IGscStatus,
    IGscKeyword,
    IGscKeywordsResult,
    IGscPage,
    IGscPagesResult,
    IGscDailyKeywords,
    ITrafficBucket,
    IBotClassDailyPoint
} from './client';
