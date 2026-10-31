/**
 * @fileoverview Every label a bot rule may assign, as a runtime list.
 *
 * Why it exists: the backend validates a rule's label against this list and the
 * admin form offers it as a dropdown, so both read one definition instead of
 * keeping two copies that could drift apart.
 */

import type { BotRuleLabel } from './BotRuleLabel.js';

/**
 * The labels a bot rule may assign, in the order the admin form lists them.
 * `bot_other` comes first because it is the right label for most automated
 * traffic that no named family describes.
 */
export const BOT_RULE_LABELS: readonly BotRuleLabel[] = [
    'bot_other',
    'scanner',
    'ai_crawler',
    'search_engine',
    'social_unfurler',
    'uptime_probe'
];
