export type { Block } from './Block.js';
export type { IBaseObserver, IBaseBatchObserver, TransactionBatches, IBaseBlockObserver, IBlockData, IBlockchainObserverService, IWebSocketService, IPluginContext, IObserverStats, IPluginWebSocketManager, PluginSubscriptionHandler, PluginUnsubscribeHandler, IPluginWebSocketStats, IAggregatePluginWebSocketStats } from './observer/index.js';
export type { IPlugin, IPluginManifest, IAdminUIConfig, IApiRouteConfig, HttpMethod, ApiRouteHandler, ApiMiddleware, IMenuItemConfig, IPageConfig, IServerDataContext, IPluginPageMetadata, IPluginMetadata, IPluginManagementRequest, IPluginManagementResponse, IPluginInfo, IFrontendPluginContext, IUIComponents, ILayoutComponents, ISubMenuItem, IChartComponents, ISystemComponents, IApiClient, IWebSocketClient, IPluginUserState } from './plugin/index.js';
export { definePlugin } from './plugin/index.js';
export type { ITransaction, ITransactionPersistencePayload, ITransactionCategoryFlags } from './transaction/index.js';
export { ProcessedTransaction } from './transaction/index.js';
export type { IHttpRequest, IHttpResponse, IHttpNext } from './http/index.js';
// DRAFT (tronrelic#289) — proposed core-owned HTTP client contract; additive and
// unwired. Will replace the leaked axios AxiosInstance on IPluginContext.http
// after the consumer review tracked in the issue.
export type { IHttpClient, IHttpRequestConfig, IHttpResponseEnvelope, HttpResponseType, IAbortSignalLike } from './http/index.js';
export type { IAuthSession, IAuthSessionUser, IHasAuthSession } from './auth/index.js';
export { ADMIN_GROUP_ID, isLoggedIn, isAnonymous, isInGroup, isAdmin, hasPrimaryWallet } from './auth/index.js';
// ILogger removed - use ISystemLogService instead (exported from './system-log/index.js')
export type { IChainParameters } from './chain-parameters/IChainParameters.js';
export type { IChainParametersService } from './chain-parameters/IChainParametersService.js';
export type { IChainParametersFetcher } from './chain-parameters/IChainParametersFetcher.js';
export type { IUsdtParameters } from './usdt-parameters/IUsdtParameters.js';
export { USDT_CONTRACT_ADDRESS } from './usdt-parameters/IUsdtParameters.js';
export type { IUsdtParametersService } from './usdt-parameters/IUsdtParametersService.js';
export type { IUsdtParametersFetcher } from './usdt-parameters/IUsdtParametersFetcher.js';
export type { ICacheService } from './services/ICacheService.js';
export type { IServiceRegistry, IServiceWatchHandlers, ServiceWatchDisposer } from './services/IServiceRegistry.js';
export type { ISignatureService } from './services/ISignatureService.js';
export type { IMenuNode, IMenuNodeWithChildren, IMenuViewer, IMenuTree, IMenuValidation, MenuEventType, IMenuEvent, MenuEventSubscriber, IMenuService, IMenuNamespaceConfig, MenuNodeOrigin, IMenuNodeAdminView, IMenuNodeAdminViewWithChildren, IMenuTreeAdminView } from './menu/index.js';
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
export type {
    NotificationSeverity,
    NotificationContentFeature,
    NotificationDisposer,
    INotificationAudience,
    INotificationCategory,
    INotificationRecipient,
    IRenderedNotification,
    IChannelDeliveryResult,
    INotificationChannel,
    INotificationRequest,
    INotificationChannelTally,
    INotificationReceipt,
    INotificationChannelInfo,
    INotificationService,
    INotificationPreferences,
    INotificationPreferenceUpdate,
    INotificationPolicy,
    INotificationAuditRecord,
    INotificationAuditQuery
} from './notifications/index.js';
export type { IWalletService, ILinkedWallet, WalletAction, IWalletChallenge, IWalletMutationInput, IAccountDirectoryService, IAccountSummary, IListAccountsOptions, IListAccountsResult, IUserSettingsService, IUserSettingDefinition } from './identity/index.js';
export type { IUserGroup, ICreateUserGroupInput, IUpdateUserGroupInput, IUserGroupService } from './user/index.js';
export type { ITronGridService, ITronGridAccountResponse, ITronGridAccountPermission } from './tron-grid/index.js';
export type { ITrc10, ITrc10FrozenSupply } from './trc10/index.js';
export type { IBlockStats, IBlock, IBlockTransaction, IBlockTransactionParty, IBlockTransactionContract, IResourceUsage, IValueTransfer, ValueTransferOrigin, ValueAssetType, IBlockchainService, ITransactionTimeseriesPoint, IOverviewTimeseriesPoint, OverviewTimeseriesWindow, ITransactionDetailService } from './blockchain/index.js';
export type { IToolsService, IAddressConversionResult, IAddressValidationResult } from './tools/index.js';
export type { AccountIngestionStatus, AccountHistoryTickKind, AccountHistoryTickSkipReason, IAccountHistorySourceFlags, IAccountHistorySourcePages, IAccountHistoryTickAccountOutcome, IAccountHistoryTickOutcome, ITrackedAccount, IAccountIngestionProgress, IAccountHistorySettings, IAccountHistoryAccountStats, IAccountHistoryStats, IAddTrackedAccountInput, IAccountTransactionQuery, IValueTransferCursor, IValueTransferQuery, IAccountTransactionPage, IActivityCalendarBucket, IWalletActivityStats, IWalletResourceTotals, FlowGranularity, IWalletFlowBucket, IWalletCounterparty, IWalletActivitySummary, IWalletValuationSummary, IAccountTokenBalance, IAccountBalanceSnapshot, ITokenMetadata, IAccountHistoryService } from './account-history/index.js';
export { PRICE_ASSET_TRX } from './price-history/index.js';
export type { PriceAsset, IPricePoint, IPriceHistorySettings, IPriceAssetCoverage, IPriceHistoryStats, IPriceCoverageDiagnostics, IPriceHistoryService } from './price-history/index.js';
export type { PortfolioScope, IPortfolioQuery, IPortfolioHolding, IPortfolioAllocationSlice, IPortfolioBalancePoint, IPortfolioSummary, IValuationService } from './valuation/index.js';
export type { IAiTool, IAiToolInputSchema, IAiConversationMessage, IAiProvider, IAiStreamChunk, IAiQueryRecord, AiQueryMode, IAiQueryOptions, IAiQueryResult, IModelInfo, ISavedPrompt, IAiTranscriptSegment, IAiThinkingSegment, IAiTextSegment, IAiToolUseSegment, IAiToolResultSegment } from './ai-tools/index.js';
export { AI_TOOL_NAME_PATTERN } from './ai-tools/index.js';
export { UNTRUSTED_CONTENT_NOTICE, UNTRUSTED_CONTENT_SYSTEM_CLAUSE, wrapUntrustedToolResult } from './ai-tools/index.js';
export { DEFAULT_UNTRUSTED_SCREEN_CONFIG } from './ai-tools/index.js';
export type {
    IUntrustedToolResult,
    IContentScreenVerdict,
    IUntrustedScreenConfig,
    UntrustedScreenPostureMode,
    UntrustedScreenFailureMode,
    IAiToolCapability,
    AiToolSideEffect,
    AiToolSensitivity,
    IToolPolicy,
    IToolPolicyDecision,
    ToolPolicyVerdict,
    IToolInvocationContext,
    IToolInvocationActor,
    IToolEndUserPrincipal,
    ToolTriggerPath,
    IToolInvocationResult,
    ToolInvocationStatus,
    IToolInvocationRecord,
    IServerToolInvocation,
    IAiToolGovernor,
    IAiToolRegistry,
    IAiToolDeclaration,
    IAiToolInfo,
    ITrifectaStatus,
    TrifectaSeverity,
    IAiProviderInfo,
    IAiProviderRegistry,
    IAiToolInvokeContext,
    IPromptVariableDefinition,
    IStaticPromptVariable,
    IPromptVariableInfo,
    IResolvedPromptVariable,
    IExpandedPromptVariable,
    PromptVariableKind,
    IPromptVariableRegistry,
    IStaticPromptVariableInput,
    IStaticPromptVariableUpdate
} from './ai-tools/index.js';
export { isPrivateIp, assertPublicHttpUrl } from './egress/index.js';
export type { IEgressCheckResult, IEgressCheckOptions } from './egress/index.js';
export type {
    IContentDescriptor,
    IContentDescriptorField,
    IContentDescriptorMedia,
    IContentType,
    IContentRegistry,
    IContentTypeInfo,
    ContentTypeDisposer
} from './content/index.js';
export {
    CONTENT_EGRESS_LEVELS,
    CONTENT_AUDIENCE_LEVELS,
    CONTENT_DESCRIPTOR_FEATURES,
    CONTENT_SINK_KINDS,
    readContentField
} from './content/index.js';
export type {
    ContentEgress,
    ContentAudience,
    IContentClassification,
    IContentSink,
    IContentSinkInfo,
    IContentSinkRefusal,
    IContentDeliveryContext,
    ContentDescriptorFeature,
    ContentSinkKind,
    ContentSinkDisposer,
    IContentRouter,
    IClassificationGate,
    IContentRoutingPolicy,
    IContentFields
} from './content/index.js';
export type {
    ICurationPreview,
    ICurationPreviewField,
    ICurationPreviewMedia,
    ICurationItem,
    CurationItemStatus,
    ICurationType,
    ICurationEditPatch,
    ICurationService,
    ICurationRegistry,
    ICurationTypeInfo,
    ICurationHoldInput,
    ICurationEligibleDestination,
    ICurationDestinationSelection,
    ICurationDestinationOutcome,
    CurationDestinationStatus
} from './curation/index.js';
export { SYNDICATION_SERVICE, SYNDICATION_LEG_STATUSES } from './syndication/index.js';
export type {
    SyndicationLegStatus,
    ISyndicationLeg,
    ISyndicationRequest,
    ISyndicationEnqueueResult,
    ISyndicationLegView,
    ISyndicationStats,
    ISyndicationService
} from './syndication/index.js';
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
    ICoreSsrHooks,
    ICoreAiHooks,
    ICoreHttpHooks,
    ICoreSchedulerHooks,
    IWalletLinkedContext,
    ISyndicationDeliveredContext
} from './hooks/index.js';
export { HookAbortError, isHookAbortError } from './hooks/index.js';
export type { IHeadFragment, HeadFragmentTag, ISsrHeadContext } from './ssr/index.js';
export type {
    IZoneDescriptor,
    ZoneHost,
    ZoneLayout,
    IZoneSnapshot,
    IZoneSnapshotRecord,
    IZoneLayoutConfig,
    ZoneFlexDirection,
    ZoneJustifyContent,
    ZoneAlignItems,
    ZoneFlexWrap,
    ZoneGapSize,
    ZoneLayoutPreset,
    ZoneCollapseBreakpoint,
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
