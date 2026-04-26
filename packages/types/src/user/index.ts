export { USER_FILTERS } from './IUserFilter.js';
export type { UserFilterType } from './IUserFilter.js';

export { USER_IDENTITY_STATES } from './IUserIdentityState.js';
export type { UserIdentityState } from './IUserIdentityState.js';

export type {
    IUser,
    IWalletLink,
    IUserPreferences,
    IUserActivity,
    IUserSession,
    IUtmParams,
    IPageVisit,
    DeviceCategory,
    ScreenSizeCategory
} from './IUser.js';

export type {
    IUserGroup,
    ICreateUserGroupInput,
    IUpdateUserGroupInput
} from './IUserGroup.js';

export type { IUserGroupService } from './IUserGroupService.js';

export type {
    BucketInterval,
    IUserService,
    IUserActivitySummary,
    IUserWalletSummary,
    IUserRetentionSummary,
    IUserPreferencesSummary,
    IPageTrafficHistory,
    IPageTrafficBucket,
    IPageTrafficEntry,
    IRecentPageViewsResult,
    IRecentPageView,
    ITrafficSourcesHistory,
    IDailyTrafficSourceBucket,
    IDailyTrafficSourceEntry,
    IGeoDistributionHistory,
    IDailyGeoBucket,
    IDailyGeoEntry,
    IDeviceBreakdownHistory,
    IDailyDeviceBucket,
    ILandingPagesHistory,
    IDailyLandingPageBucket,
    IDailyLandingPageEntry,
    ICampaignPerformanceHistory,
    IDailyCampaignBucket,
    IDailyCampaignEntry,
    ISessionDurationHistory,
    IDailySessionDurationBucket,
    IPagesPerSessionHistory,
    IDailyPagesPerSessionBucket,
    INewVsReturningHistory,
    IDailyNewVsReturningBucket,
    IWalletConversionHistory,
    IDailyWalletConversionBucket,
    IExitPagesHistory,
    IDailyExitPageBucket,
    IDailyExitPageEntry
} from './IUserService.js';
