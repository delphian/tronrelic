/**
 * @fileoverview Physical MongoDB collection names owned by the consent module.
 *
 * Every name carries the `module_consent_` prefix, which is the string the
 * Database tab on `/system/consent` scopes its browser to. Keeping the names in
 * one place means the services, the tests, and that prefix cannot drift apart.
 */

/** Prefix shared by every collection this module owns. */
export const CONSENT_COLLECTION_PREFIX = 'module_consent_';

/** The module's settings, one document keyed `settings`. */
export const SETTINGS_COLLECTION = `${CONSENT_COLLECTION_PREFIX}settings`;

/** Page views from visitors without analytics consent, one counter per UTC day. */
export const PAGEVIEW_DAILY_COLLECTION = `${CONSENT_COLLECTION_PREFIX}pageview_daily`;
