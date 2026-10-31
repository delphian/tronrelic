/**
 * @fileoverview Who created a bot rule.
 *
 * Why it exists: an operator reading the rule list needs to know whether a rule
 * was written by an admin, proposed by an AI agent, or carried over from the
 * automated-network list it replaced.
 */

/**
 * `admin` was written on `/system/traffic`, `ai-tool` was proposed by an agent,
 * and `migration` was moved over from the old automated-network list.
 */
export type BotRuleSource = 'admin' | 'ai-tool' | 'migration';
