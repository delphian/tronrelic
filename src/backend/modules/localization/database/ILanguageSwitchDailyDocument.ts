/**
 * @fileoverview Stored shape of one day's language-switch counter.
 */

/**
 * One document in `module_localization_switch_daily`, unique on
 * `(day, from, to, pattern)`. Each switcher click that passes validation adds
 * one to `count` on the matching document, creating it on the first click of
 * the day.
 *
 * Counters are stored rather than one row per click because the admin page
 * only ever asks for totals, and because every key field comes from a bounded
 * set — enabled languages and published route patterns — so the collection
 * grows by at most a few documents a day.
 */
export interface ILanguageSwitchDailyDocument {
    /** UTC day as `YYYY-MM-DD`, which also sorts correctly as a string. */
    day: string;
    /** Language the visitor was reading. */
    from: string;
    /** Language the visitor clicked. */
    to: string;
    /** Published route pattern covering the page the click happened on. */
    pattern: string;
    /** Switches recorded for this day, direction, and route. */
    count: number;
}
