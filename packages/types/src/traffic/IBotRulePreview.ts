/**
 * @fileoverview What a bot rule's conditions would have matched in recent traffic.
 *
 * Why it exists: a rule that catches real visitors corrupts the figures it was
 * meant to clean. Running the conditions against recent events before saving,
 * and reporting signs of real people among the matches, lets an operator judge a
 * rule from data rather than guesswork.
 */

import type { IBotRulePreviewSample } from './IBotRulePreviewSample.js';

/**
 * Preview of a set of rule conditions over a recent window. Logged-in events are
 * never matched, because a rule never labels a logged-in visitor.
 */
export interface IBotRulePreview {
    /** Length of the window the preview covered, in days. */
    windowDays: number;

    /** Start of the window, as an ISO-8601 UTC string. */
    windowStart: string;

    /** End of the window, as an ISO-8601 UTC string. */
    windowEnd: string;

    /** Traffic events the conditions matched. */
    matchedEvents: number;

    /** Distinct browser cookies among the matched events. */
    matchedCookies: number;

    /**
     * Matched events grouped by the bot class they carry today. Events already
     * labeled as a bot would not change, so the `human` count is what the rule
     * would actually relabel.
     */
    eventsByCurrentLabel: Record<string, number>;

    /**
     * Matched cookies that were logged in at some point in the window. Any
     * number above zero means the rule touches real account holders.
     */
    loggedInCookies: number;

    /**
     * Matched cookies seen on two or more different days in the window.
     * Crawlers usually take a fresh cookie for every page, so returning cookies
     * suggest real visitors.
     */
    returningCookies: number;

    /** Distinct referrer domains among the matched events. */
    distinctReferrerDomains: number;

    /** Distinct browser identifiers among the matched events. */
    distinctUserAgents: number;

    /** Up to ten of the most recent matched events. */
    samples: IBotRulePreviewSample[];
}
