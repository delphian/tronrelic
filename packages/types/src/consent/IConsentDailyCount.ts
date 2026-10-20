/**
 * @fileoverview One day's count of anonymous page views.
 */

/** A UTC day and how many page views it recorded. */
export interface IConsentDailyCount {
    /** The UTC day, as `YYYY-MM-DD`. */
    day: string;

    /** Page views counted that day. */
    count: number;
}
