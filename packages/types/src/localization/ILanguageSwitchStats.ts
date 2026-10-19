/**
 * @fileoverview Language switcher usage over a window, for the admin page.
 */

import type { ILanguageSwitchDay } from './ILanguageSwitchDay.js';
import type { ILanguageSwitchPair } from './ILanguageSwitchPair.js';
import type { ILanguageSwitchRoute } from './ILanguageSwitchRoute.js';

/**
 * What `GET /api/admin/system/localization/switches` returns: how often
 * visitors used the language switcher in a trailing window of whole UTC days,
 * broken down by day, by direction, and by route.
 *
 * Only clicks that moved the visitor to a different language on a page
 * published in both languages are counted. Visitors on the traffic ignore list
 * and browsers reporting automation are left out when the click arrives, so a
 * change to the ignore list does not change figures already recorded.
 */
export interface ILanguageSwitchStats {
    /** Window length in days, today included. */
    days: number;

    /** First UTC day in the window, `YYYY-MM-DD`. */
    windowStart: string;

    /** Last UTC day in the window (today), `YYYY-MM-DD`. */
    windowEnd: string;

    /** Switches recorded in the window. */
    total: number;

    /** One entry per day in the window, oldest first, zero for quiet days. */
    byDay: ILanguageSwitchDay[];

    /** Each direction seen in the window, most used first. */
    byPair: ILanguageSwitchPair[];

    /** Each route pattern seen in the window, most used first. */
    byRoute: ILanguageSwitchRoute[];
}
