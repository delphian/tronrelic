/**
 * @fileoverview The conditions a traffic event must meet for a bot rule to match.
 *
 * Why it exists: an operator identifies automated traffic from the shape of its
 * data — the network it runs on, the country, the browser identifier, the pages
 * it reads, whether it sends a referrer. Holding those as data lets an operator
 * describe a new crawler on `/system/traffic` without a code change.
 *
 * Every condition that is set must match (AND). Inside a list, any one entry
 * may match (OR), except `userAgentContains`, where every entry must appear.
 * A rule must set at least one condition, so an empty rule can never label all
 * traffic.
 */

import type { IBotRuleNetworkMismatch } from './IBotRuleNetworkMismatch.js';

/**
 * Conditions a bot rule tests against each traffic event.
 */
export interface IBotRuleConditions {
    /**
     * Autonomous system numbers (network operators) to match. The event's network
     * comes from Cloudflare, so a client cannot change it.
     */
    asns?: number[];

    /**
     * Two-letter country codes to match, read from Cloudflare's country header
     * or the local lookup when that is missing.
     */
    countries?: string[];

    /**
     * Text the browser identifier (User-Agent) must contain, compared without
     * regard to case. Every entry must appear, so `chrome/145.0.0.0` together
     * with `macintosh` narrows to one exact browser build.
     */
    userAgentContains?: string[];

    /**
     * Path prefixes such as `/vi/` or `/zh/`. The event matches when its path
     * starts with any one of them.
     */
    pathPrefixes?: string[];

    /**
     * Restrict the rule to server-recorded page loads (`bootstrap`) or the
     * browser's JavaScript reports (`page`).
     */
    eventType?: 'bootstrap' | 'page';

    /**
     * Require the event to have no referrer (`absent`) or to have one
     * (`present`). Page reports are tested on the referrer the browser reported
     * for the landing page.
     */
    referrer?: 'absent' | 'present';

    /**
     * Require the page report to come from a different network or country than
     * the same cookie's page load, within a short time. Applies to `page` events
     * only.
     */
    networkMismatch?: IBotRuleNetworkMismatch;
}
