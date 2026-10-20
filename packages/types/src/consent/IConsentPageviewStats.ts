/**
 * @fileoverview Page views from visitors who have not allowed analytics.
 */

import type { IConsentDailyCount } from './IConsentDailyCount.js';

/**
 * What the Settings tab of `/system/consent` shows about visitors without
 * analytics consent: those in a consent region who declined or have not
 * answered yet, and anyone elsewhere who opted out from "Privacy choices".
 *
 * Their page views carry no visitor identifier, so they are kept as plain
 * daily totals rather than in the traffic dashboard, whose visitor and
 * session figures are built from that identifier. The traffic dashboard
 * therefore undercounts by about this many page views.
 */
export interface IConsentPageviewStats {
    /** Window length in whole UTC days, today included. */
    days: number;

    /** First day of the window, as `YYYY-MM-DD`. */
    windowStart: string;

    /** Last day of the window, as `YYYY-MM-DD`. */
    windowEnd: string;

    /** Page views across the whole window. */
    total: number;

    /** One entry per day in the window, oldest first, with zero for a day with none. */
    byDay: IConsentDailyCount[];
}
