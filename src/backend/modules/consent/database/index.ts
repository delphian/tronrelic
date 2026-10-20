/**
 * @fileoverview Barrel for the consent module's storage shapes and collection names.
 */

export type { IConsentSettingsDocument } from './IConsentSettingsDocument.js';
export type { IConsentPageviewDailyDocument } from './IConsentPageviewDailyDocument.js';
export { CONSENT_COLLECTION_PREFIX, SETTINGS_COLLECTION, PAGEVIEW_DAILY_COLLECTION } from './consent-collections.js';
export { ensureConsentIndexes } from './ensureConsentIndexes.js';
