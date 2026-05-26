export type { Block } from './Block.js';
export type { IBaseObserver, IBaseBatchObserver, TransactionBatches, IBaseBlockObserver, IBlockData, IBlockchainObserverService, IWebSocketService, IPluginContext, IObserverStats, IPluginWebSocketManager, PluginSubscriptionHandler, PluginUnsubscribeHandler, IPluginWebSocketStats, IAggregatePluginWebSocketStats } from './observer/index.js';
export type { IPlugin, IPluginManifest, IAdminUIConfig, IPluginDatabase, IApiRouteConfig, HttpMethod, ApiRouteHandler, ApiMiddleware, IMenuItemConfig, IPageConfig, IPluginMetadata, IPluginManagementRequest, IPluginManagementResponse, IPluginInfo, IFrontendPluginContext, IUIComponents, ILayoutComponents, IChartComponents, ISystemComponents, IApiClient, IWebSocketClient, IPluginUserState, IPluginWalletLink } from './plugin/index.js';
export { definePlugin } from './plugin/index.js';
export type { ITransaction, ITransactionPersistencePayload, ITransactionCategoryFlags } from './transaction/index.js';
export { ProcessedTransaction } from './transaction/index.js';
export type { IHttpRequest, IHttpResponse, IHttpNext } from './http/index.js';
// ILogger removed - use ISystemLogService instead (exported from './system-log/index.js')
export type { IChainParameters } from './chain-parameters/IChainParameters.js';
export type { IChainParametersService } from './chain-parameters/IChainParametersService.js';
export type { IChainParametersFetcher } from './chain-parameters/IChainParametersFetcher.js';
export type { IUsdtParameters } from './usdt-parameters/IUsdtParameters.js';
export type { IUsdtParametersService } from './usdt-parameters/IUsdtParametersService.js';
export type { IUsdtParametersFetcher } from './usdt-parameters/IUsdtParametersFetcher.js';
export type { ICacheService } from './services/ICacheService.js';
export type { IServiceRegistry, IServiceWatchHandlers, ServiceWatchDisposer } from './services/IServiceRegistry.js';
export type { ISignatureService } from './services/ISignatureService.js';
export type { IMenuNode, IMenuNodeWithChildren, IMenuTree, IMenuValidation, MenuEventType, IMenuEvent, MenuEventSubscriber, IMenuService, IMenuNamespaceConfig, MenuNodeOrigin, IMenuNodeAdminView, IMenuNodeAdminViewWithChildren, IMenuTreeAdminView } from './menu/index.js';
export type {
    IWidgetData,
    IWidgetComponentProps,
    WidgetComponent,
    IWidgetsService,
    IRegisterWidgetTypeInput,
    IRegisterZoneInput,
    IRegisterWidgetInput,
    WidgetsRegistrationDisposer
} from './widget/index.js';
export type { ISystemConfig, ISystemConfigService } from './system-config/index.js';
export type { ISystemLogService, ISystemLogQuery, ISystemLogPaginatedResponse, ISaveLogData, LogLevel } from './system-log/index.js';
export { LOG_LEVELS, shouldLog, type LogLevelName } from './system-log/index.js';
export type { ISchedulerService, CronJobHandler } from './scheduler/ISchedulerService.js';
export type { IDatabaseService } from './database/IDatabaseService.js';
export type { IMigration, IMigrationContext, MigrationTarget } from './database/IMigration.js';
export type { IClickHouseService } from './clickhouse/index.js';
export type { IPage, IPageSettings, IPageService, IMarkdownService, IFrontmatterData, IParsedMarkdown } from './pages/index.js';
export type { IStorageProvider, IStorageObjectStat, IFileService, IFileRecord, IFileSource, IFileUploadOptions, IFileListFilter, IVariantOptions, IFileVariant, IFilesSettings, IFilesSettingsService } from './files/index.js';
export { FILE_SOURCE_KINDS, FileValidationError, FileSizeExceededError } from './files/index.js';
export type { IModule, IModuleMetadata } from './module/index.js';
export { USER_FILTERS, USER_IDENTITY_STATES, UserIdentityState, SESSION_TTL_MS, isSessionFresh } from './user/index.js';
export type { UserFilterType, BucketInterval, IUser, IWalletLink, IUserPreferences, IUserActivity, IUserSession, IUtmParams, IPageVisit, DeviceCategory, ScreenSizeCategory, IUserService, IUserActivitySummary, IUserWalletSummary, IUserRetentionSummary, IUserPreferencesSummary, IPageTrafficHistory, IPageTrafficBucket, IPageTrafficEntry, IRecentPageViewsResult, IRecentPageView, ITrafficSourcesHistory, IDailyTrafficSourceBucket, IDailyTrafficSourceEntry, IGeoDistributionHistory, IDailyGeoBucket, IDailyGeoEntry, IDeviceBreakdownHistory, IDailyDeviceBucket, ILandingPagesHistory, IDailyLandingPageBucket, IDailyLandingPageEntry, ICampaignPerformanceHistory, IDailyCampaignBucket, IDailyCampaignEntry, ISessionDurationHistory, IDailySessionDurationBucket, IPagesPerSessionHistory, IDailyPagesPerSessionBucket, INewVsReturningHistory, IDailyNewVsReturningBucket, IWalletConversionHistory, IDailyWalletConversionBucket, IExitPagesHistory, IDailyExitPageBucket, IDailyExitPageEntry, IUserGroup, ICreateUserGroupInput, IUpdateUserGroupInput, IUserGroupService, IAuthStatus, ISessionFreshnessInput } from './user/index.js';
export type { ITronGridService, ITronGridAccountResponse, ITronGridAccountPermission } from './tron-grid/index.js';
export type { IBlockStats, IBlock, IBlockchainService, ITransactionTimeseriesPoint } from './blockchain/index.js';
export type { IAddressLabel, IResolvedAddressLabel, AddressCategory, AddressLabelSourceType, ITronAddressMetadata, IAddressLabelService, ICreateAddressLabelInput, IUpdateAddressLabelInput, IAddressLabelFilter, IAddressLabelImportResult, IAddressLabelListResult } from './address-label/index.js';
export type { IToolsService, IAddressConversionResult, IAddressValidationResult } from './tools/index.js';
export type { IAiTool, IAiToolInputSchema, IAiAssistantService, IAiQueryOptions, IAiQueryResult, IModelInfo } from './ai-tools/index.js';
export { AI_TOOL_NAME_PATTERN } from './ai-tools/index.js';
export type {
    HookDescriptor,
    HookKind,
    HookPhase,
    HookPredicate,
    HookHandler,
    ObserverHookHandler,
    SeriesHookHandler,
    WaterfallHookHandler,
    BailHookHandler,
    IHookRegistry,
    IHookRegisterOptions,
    HookRegisterDisposer,
    IHookHandlerRecord,
    IHookSnapshotRecord,
    IHookSnapshot,
    IPluginHooks,
    ICoreHooks,
    ICoreSsrHooks
} from './hooks/index.js';
export { HookAbortError, isHookAbortError } from './hooks/index.js';
export type { IHeadFragment, HeadFragmentTag, ISsrHeadContext } from './ssr/index.js';
export type {
    IZoneDescriptor,
    ZoneHost,
    ZoneLayout,
    IZoneSnapshot,
    IZoneSnapshotRecord,
    // Internal — used only by widgets-module implementation. Consumers
    // (plugins, other modules) reach zone state through IWidgetsService.
    IZoneRegistry,
    IDefineZoneOptions,
    ZoneRegisterDisposer
} from './widget-zones/index.js';
export type {
    IWidgetType,
    IWidgetPlacementContext,
    WidgetDataFetcher,
    IWidgetTypeSnapshot,
    IWidgetTypeSnapshotRecord,
    // Internal — used only by widgets-module implementation. Consumers
    // (plugins, other modules) reach widget-type state through IWidgetsService.
    IWidgetTypeRegistry,
    IDefineWidgetTypeOptions,
    WidgetTypeRegisterDisposer
} from './widget-types/index.js';
export type {
    IWidgetPlacement,
    IPlacementInput,
    PlacementSource,
    IPlacementListFilter,
    IPlacementPatch,
    // Internal — used only by widgets-module implementation. Consumers
    // reach placement operations through IWidgetsService.
    IPlacementService,
    IPluginPlacementInput
} from './widget-placements/index.js';
