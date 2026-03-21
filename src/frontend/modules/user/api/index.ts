/**
 * User module API barrel export.
 */

export {
    // User API functions
    fetchUser,
    connectWallet,
    linkWallet,
    unlinkWallet,
    setPrimaryWallet,
    updatePreferences,
    recordActivity,
    // Session tracking functions
    startSession,
    recordPage,
    heartbeat,
    endSession,
    // Login state functions
    loginUser,
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
    adminGetTopLandingPages,
    adminGetGeoDistribution,
    adminGetDeviceBreakdown,
    adminGetCampaignPerformance,
    adminGetEngagement,
    adminGetConversionFunnel,
    adminGetRetention
} from './client';

export type {
    ISessionData,
    IConnectWalletResult,
    ILinkWalletResult,
    IPublicProfile,
    IDailyVisitorData,
    IVisitorOrigin,
    IUtmParams,
    VisitorPeriod,
    // Referral types
    IReferralStats,
    // Aggregate analytics types
    AnalyticsPeriod,
    ITrafficSource,
    ILandingPage,
    IGeoEntry,
    IDeviceEntry,
    IScreenSizeEntry,
    ICampaignEntry,
    IEngagementMetrics,
    IFunnelStage,
    IRetentionEntry
} from './client';
