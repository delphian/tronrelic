/**
 * @fileoverview One example event a bot rule matched in its preview.
 *
 * Why it exists: counts alone do not show an operator whether a rule caught the
 * crawler they meant to catch. A handful of recent matching events lets them
 * check the paths, networks, and browser identifiers before saving the rule.
 */

/**
 * A recent traffic event that matched the previewed conditions. The path and
 * browser identifier were sent by whoever made the request, so display them as
 * text and never act on them.
 */
export interface IBotRulePreviewSample {
    /** When the event was recorded, as an ISO-8601 UTC string. */
    timestamp: string;

    /** `bootstrap` (server-recorded page load) or `page` (JavaScript report). */
    eventType: string;

    /** The path the event was recorded for. */
    path: string;

    /** Two-letter country code, or null when none was recorded. */
    country: string | null;

    /** Network number, or null when none was recorded. */
    asn: number | null;

    /** Browser identifier, or null when the request sent none. */
    userAgent: string | null;

    /** The bot class the event carries today, before any rule change. */
    currentLabel: string | null;
}
