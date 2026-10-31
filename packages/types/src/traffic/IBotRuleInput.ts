/**
 * @fileoverview The fields an operator sends to create or replace a bot rule.
 *
 * Why it exists: the create and update endpoints accept the same editable
 * fields, and the admin form builds exactly this shape. Status, source,
 * evidence, and timestamps are managed by the server and cannot be sent.
 */

import type { BotRuleLabel } from './BotRuleLabel.js';
import type { BotRuleMode } from './BotRuleMode.js';
import type { IBotRuleConditions } from './IBotRuleConditions.js';

/**
 * Editable fields of a bot rule.
 */
export interface IBotRuleInput {
    /** Short name the operator recognises the rule by. */
    name: string;

    /** Why the rule exists. Optional. */
    note?: string | null;

    /** What an event must look like for the rule to match. At least one condition is required. */
    conditions: IBotRuleConditions;

    /** The bot class written to a matched event in `label` mode. */
    label: BotRuleLabel;

    /** Whether a match changes the event's label or is only counted. */
    mode: BotRuleMode;

    /** False pauses the rule. Defaults to true. */
    enabled?: boolean;

    /** ISO-8601 date after which the rule stops being evaluated, or null for none. */
    expiresAt?: string | null;
}
