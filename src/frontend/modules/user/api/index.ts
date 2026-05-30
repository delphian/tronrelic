/**
 * User module API barrel export.
 *
 * Surfaces the admin analytics + Google Search Console client used by the
 * `/system/users` dashboards. The legacy UUID user/wallet/session/profile/
 * referral calls were removed in the Better Auth cutover.
 */

export {
    // Visitor analytics
    adminGetDailyVisitors,
    adminGetNewUsers,
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
    // Google Search Console functions
    adminGetGscStatus,
    adminSaveGscCredentials,
    adminRemoveGscCredentials,
    adminRefreshGscData
} from './client';

export type {
    IDailyVisitorData,
    IVisitorOrigin,
    IUtmParams,
    VisitorPeriod,
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
    IGscStatus
} from './client';
