/**
 * User module API barrel export.
 */

export {
    // User API functions
    fetchUser,
    bootstrapUser,
    connectWallet,
    requestWalletChallenge,
    linkWallet,
    unlinkWallet,
    setPrimaryWallet,
    refreshWalletVerification,
    updatePreferences,
    recordActivity,
    // Session tracking functions
    startSession,
    recordPage,
    heartbeat,
    endSession,
    // Logout
    logoutUser,
    // Public profile functions
    fetchProfile,
    // Referral functions
    fetchReferralStats,
    // Admin API functions
    adminListUsers,
    adminGetUserStats,
    adminGetUser,
    adminGetDailyVisitors,
    adminGetVisitorOrigins,
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
    // Referral analytics functions
    adminGetReferralOverview
} from './client';

export type {
    ISessionData,
    IConnectWalletResult,
    ILinkWalletResult,
    IWalletChallenge,
    WalletChallengeAction,
    IPublicProfile,
    IDailyVisitorData,
    IVisitorOrigin,
    IUtmParams,
    VisitorPeriod,
    // Referral types
    IReferralStats,
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
    // Referral analytics types
    IReferralOverview,
    ITopReferrer,
    IRecentReferral
} from './client';
