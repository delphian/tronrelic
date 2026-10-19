/**
 * @fileoverview Language switches counted on one day.
 */

/**
 * The number of language switches recorded on one UTC day. The stats read
 * returns one entry for every day in its window, including days with none, so
 * a chart shows quiet days as gaps rather than closing them up.
 */
export interface ILanguageSwitchDay {
    /** UTC day as `YYYY-MM-DD`. */
    day: string;

    /** Switches recorded that day. */
    count: number;
}
