/**
 * @fileoverview Stored shape of one day's anonymous page view counter.
 */

/**
 * One document per UTC day in `module_consent_pageview_daily`. It holds a
 * count and nothing else, which is what makes it acceptable to keep for
 * visitors who declined analytics: there is no identifier, address, or path.
 */
export interface IConsentPageviewDailyDocument {
    /** The UTC day, as `YYYY-MM-DD`. Unique. */
    day: string;
    /** Page views counted that day. */
    count: number;
}
