/**
 * @fileoverview Accepted shape of a Google Ads tag id.
 *
 * The id is placed into a script URL and a `gtag('config', …)` call, so the
 * backend refuses anything that is not exactly `AW-` followed by digits. That
 * keeps a mistyped or malicious value from reaching the page.
 */

/** A Google Ads tag id, such as `AW-123456789`. */
export const GOOGLE_ADS_ID_PATTERN = /^AW-\d{6,15}$/;
