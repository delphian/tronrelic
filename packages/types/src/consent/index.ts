/**
 * @fileoverview Barrel for the consent domain: the settings, a visitor's
 * saved choice, and the pure helpers the frontend middleware, the root layout,
 * and the backend share so they reach the same answer about one request.
 */

export type { IConsentPublicConfig } from './IConsentPublicConfig.js';
export type { IConsentSettings } from './IConsentSettings.js';
export type { IConsentChoice } from './IConsentChoice.js';
export type { IConsentState } from './IConsentState.js';
export type { IConsentService } from './IConsentService.js';
export type { IConsentDailyCount } from './IConsentDailyCount.js';
export type { IConsentPageviewStats } from './IConsentPageviewStats.js';

export { CONSENT_COOKIE_NAME } from './CONSENT_COOKIE_NAME.js';
export { CONSENT_COOKIE_MAX_AGE_SECONDS } from './CONSENT_COOKIE_MAX_AGE_SECONDS.js';
export { CONSENT_REGION_COUNTRIES } from './CONSENT_REGION_COUNTRIES.js';
export { GOOGLE_ADS_ID_PATTERN } from './GOOGLE_ADS_ID_PATTERN.js';
export { GOOGLE_ADS_CONVERSION_LABEL_PATTERN } from './GOOGLE_ADS_CONVERSION_LABEL_PATTERN.js';
export { isConsentRequiredCountry } from './isConsentRequiredCountry.js';
export { parseConsentCookie } from './parseConsentCookie.js';
export { serializeConsentCookie } from './serializeConsentCookie.js';
export { resolveConsentState } from './resolveConsentState.js';
