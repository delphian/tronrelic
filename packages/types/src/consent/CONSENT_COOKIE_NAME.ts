/**
 * @fileoverview Name of the cookie that stores a visitor's consent choice.
 *
 * The cookie is strictly necessary, because it is how the site remembers that
 * the visitor declined, so it needs no consent of its own. It is not
 * `httpOnly`: the banner writes it in the browser so a choice takes effect
 * without a reload, and the middleware and backend read it on the next request.
 */

/** Cookie holding the serialized `IConsentChoice`. */
export const CONSENT_COOKIE_NAME = 'tronrelic_consent';
