/**
 * @file index.ts
 *
 * Barrel for the syndication contracts — the platform's durable `publish`
 * delivery family. Re-exported from the package root so consumers import from
 * `@/types` (backend) or `@delphian/tronrelic-types` (plugins) without reaching
 * into sub-paths.
 */

export { SYNDICATION_SERVICE, SYNDICATION_LEG_STATUSES } from './ISyndicationService.js';
export type {
    SyndicationLegStatus,
    ISyndicationLeg,
    ISyndicationRequest,
    ISyndicationEnqueueResult,
    ISyndicationLegView,
    ISyndicationStats,
    ISyndicationService
} from './ISyndicationService.js';
