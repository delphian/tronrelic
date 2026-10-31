/**
 * @fileoverview How often a bot rule has matched recently.
 *
 * Why it exists: a rule that never matches is either obsolete or wrong, and a
 * rule that suddenly matches far more than before may be catching real visitors.
 * Showing recent match counts beside each rule makes both visible.
 */

/**
 * Recent match counts for one rule, read from `traffic_events.bot_rule`.
 */
export interface IBotRuleStats {
    /** The rule the counts belong to. */
    ruleId: string;

    /** Events the rule matched in the last 24 hours. */
    matches24h: number;

    /** Events the rule matched in the last 7 days. */
    matches7d: number;

    /** When the rule last matched, as an ISO-8601 UTC string, or null within the last 7 days. */
    lastMatchedAt: string | null;
}
