/**
 * Traffic module API barrel export.
 *
 * Surfaces the admin analytics, crawler, and Google Search Console client
 * used by the `/system/traffic` dashboards.
 */

export {
    // Visitor analytics
    adminGetDailyVisitors,
    adminGetAnonymousFirstTouches,
    adminGetVisitors,
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
    // Bot rule functions
    adminGetBotRules,
    adminCreateBotRule,
    adminUpdateBotRule,
    adminDeleteBotRule,
    adminPreviewBotRule,
    adminGetBotRuleSuggestions,
    // Redirect management functions
    adminListRedirects,
    adminCreateRedirect,
    adminUpdateRedirect,
    adminDeleteRedirect,
    adminGetRedirectAnalytics,
    // Google Search Console functions
    adminGetGscStatus,
    adminSaveGscCredentials,
    adminRemoveGscCredentials,
    adminRefreshGscData,
    adminGetGscKeywords,
    adminGetGscPages,
    adminGetGscKeywordPages,
    adminGetGscKeywordTrend,
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
    PageHitSubject,
    IVisitorRow,
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
    IBotRuleList,
    IGscStatus,
    IGscKeyword,
    IGscKeywordsResult,
    IGscPage,
    IGscPagesResult,
    IGscKeywordPage,
    IGscKeywordPagesResult,
    IGscTrendBucket,
    IGscTrendResult,
    IGscWindowParams,
    GscGranularity,
    ITrafficBucket,
    IBotClassDailyPoint,
    IRedirectRuleAdmin,
    IRedirectRuleInput,
    IRedirectAnalytics,
    IRedirectTrendPoint,
    IRedirectPatternStat
} from './client';
