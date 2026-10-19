/**
 * @fileoverview Language switches counted on one published route.
 */

/**
 * How many switches happened on pages covered by one published route pattern
 * within the stats window. Switches are counted by route pattern rather than by
 * raw path, because the set of patterns is what an administrator publishes and
 * acts on, and it keeps the stored counters from growing with every distinct
 * URL a visitor reaches.
 */
export interface ILanguageSwitchRoute {
    /** Route pattern as published on the Routes tab, e.g. `/blog/*`. */
    pattern: string;

    /** Switches recorded in the window. */
    count: number;
}
