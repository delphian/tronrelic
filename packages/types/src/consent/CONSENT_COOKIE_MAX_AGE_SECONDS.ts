/**
 * @fileoverview How long a visitor's consent choice is kept before they are
 * asked again.
 *
 * European regulators expect consent to be renewed periodically, and the
 * French regulator's guidance caps it at 13 months. Twelve months stays inside
 * that, and both the cookie's lifetime and `resolveConsentState` use this one
 * value, so a choice older than this is ignored even if a browser kept the
 * cookie longer.
 */

/** Twelve months, in seconds. */
export const CONSENT_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
