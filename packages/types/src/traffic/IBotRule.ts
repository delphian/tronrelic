/**
 * @fileoverview A stored bot rule, as the admin API returns it.
 *
 * Why it exists: bot rules let an operator identify automated traffic from its
 * data — network, country, browser identifier, paths, referrer — and label it
 * without a code change. The admin page, the curation queue, and the AI tool
 * all read rules in this shape.
 */

import type { BotRuleLabel } from './BotRuleLabel.js';
import type { BotRuleMode } from './BotRuleMode.js';
import type { BotRuleSource } from './BotRuleSource.js';
import type { BotRuleStatus } from './BotRuleStatus.js';
import type { IBotRuleConditions } from './IBotRuleConditions.js';
import type { IBotRulePreview } from './IBotRulePreview.js';

/**
 * One bot rule. A rule is evaluated only while its status is `active`, it is
 * enabled, and it has not expired.
 */
export interface IBotRule {
    /** Stable identifier, also written to `traffic_events.bot_rule` on each match. */
    id: string;

    /** Short name the operator recognises the rule by. */
    name: string;

    /** Why the rule exists, such as who runs the network. Null when none was given. */
    note: string | null;

    /** What an event must look like for the rule to match. */
    conditions: IBotRuleConditions;

    /** The bot class written to a matched event in `label` mode. */
    label: BotRuleLabel;

    /** Whether a match changes the event's label or is only counted. */
    mode: BotRuleMode;

    /** False pauses the rule without deleting it. */
    enabled: boolean;

    /** Where the rule stands in review. */
    status: BotRuleStatus;

    /** Who created the rule. */
    source: BotRuleSource;

    /**
     * The preview recorded when an AI agent proposed the rule, so the curator
     * sees the same evidence the agent did. Null for rules an admin wrote.
     */
    evidence: IBotRulePreview | null;

    /**
     * When the rule stops being evaluated, as an ISO-8601 UTC string, or null
     * for no expiry. Networks change hands, so a rule can be set to lapse.
     */
    expiresAt: string | null;

    /** When the rule was created, as an ISO-8601 UTC string. */
    createdAt: string;

    /** When the rule last changed, as an ISO-8601 UTC string. */
    updatedAt: string;
}
