/**
 * @file index.ts
 *
 * Public API of the syndication module. Bootstrap imports the module class and
 * the relay-job constants; tests reach the service and its tuning constants.
 */

export {
    SyndicationModule,
    SYNDICATION_RELAY_JOB,
    SYNDICATION_RELAY_SCHEDULE
} from './SyndicationModule.js';
export type { ISyndicationModuleDependencies } from './SyndicationModule.js';
export {
    SyndicationService,
    DEFAULT_MAX_ATTEMPTS,
    RELAY_BATCH_LIMIT,
    CLAIM_STALE_MS
} from './services/syndication-service.js';
export type { ISyndicationServiceOptions } from './services/syndication-service.js';
export { backoffMs, BASE_BACKOFF_MS, MAX_BACKOFF_MS } from './services/syndication-backoff.js';
export { SYNDICATION_OUTBOX_COLLECTION } from './database/ISyndicationOutboxDocument.js';
export type { ISyndicationOutboxDocument } from './database/ISyndicationOutboxDocument.js';
