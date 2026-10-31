/**
 * @fileoverview A network whose recent traffic looks automated but is still
 * counted as human.
 *
 * Why it exists: finding a disguised crawler used to mean an operator or an AI
 * agent noticing a traffic spike and investigating it by hand. A daily-style
 * query can surface networks with a crawler's shape — many cookies, about one
 * page each, no referrer, no logins — so the operator can start a rule from it.
 */

/**
 * One candidate network for a new bot rule, with the figures that made it a
 * candidate. The browser identifier was sent by the client, so display it as
 * text only.
 */
export interface IBotRuleSuggestion {
    /** The network's autonomous system number. */
    asn: number;

    /** Distinct browser cookies from the network that reported a page view. */
    cookies: number;

    /** Page reports from the network. */
    events: number;

    /** Share of those reports that carried no referrer, from 0 to 1. */
    noReferrerShare: number;

    /** Distinct browser identifiers the network sent. */
    distinctUserAgents: number;

    /** The browser identifier the network sent most often. */
    topUserAgent: string | null;

    /** Up to five countries the network's traffic was recorded from. */
    countries: string[];

    /** First report from the network in the window, as an ISO-8601 UTC string. */
    firstSeen: string;

    /** Last report from the network in the window, as an ISO-8601 UTC string. */
    lastSeen: string;
}
