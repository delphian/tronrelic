/**
 * @fileoverview Public API for the traffic module.
 *
 * Cookieless behavioral analytics: the ClickHouse `traffic_events` pipeline,
 * GSC keyword integration, the bot classifier, and geo/IP derivation helpers.
 */

export { TrafficModule } from './TrafficModule.js';
export type { ITrafficModuleDependencies } from './TrafficModule.js';

export { TrafficService, buildTrafficEvent } from './services/traffic.service.js';
export type {
    ITrafficEvent,
    TrafficEventType,
    IGetEventsForUserOptions,
    ITrafficEventBuilderInputs,
    IAnalyticsDateRange,
    IDailyVisitorPoint,
    IHighVolumeSubnet,
    ITrafficSourceBucket,
    ILandingPageBucket,
    IGeoBucket,
    IDeviceBucket,
    IRetentionPoint,
    IBinaryConversionFunnel,
    ICampaignPerformanceBucket,
    IEngagementMetrics
} from './services/traffic.service.js';
export { GscService } from './services/gsc.service.js';
export type { IGscStatus, IGscKeyword, IGscQueryDocument } from './services/gsc.service.js';
export { IgnoredUsersService } from './services/ignored-users.service.js';
export type { IIgnoredUserDocument } from './services/ignored-users.service.js';
export { classifyUserAgent } from './services/bot-classifier.js';
export type { BotClass } from './services/bot-classifier.js';
export {
    initGeoIP,
    getCountryFromIP,
    extractReferrerDomain,
    extractSearchKeyword,
    isInternalReferrer,
    getDeviceCategory,
    getClientIP
} from './services/geo.service.js';

export { TrafficController } from './api/traffic.controller.js';
export { createAdminTrafficRouter, createAdminAnalyticsRouter } from './api/traffic.routes.js';
export { resolveAnalyticsRange } from './services/traffic.service.js';
export type { IAnalyticsRangeQuery } from './services/traffic.service.js';
