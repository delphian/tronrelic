/**
 * @fileoverview Whether a bot rule changes labels or only counts matches.
 *
 * Why it exists: an operator should be able to watch what a rule matches on
 * real traffic before it changes any figures. A rule in `monitor` mode records
 * which events it matched without changing their label; a rule in `label` mode
 * also writes its label to the event.
 */

/**
 * `monitor` records matches only. `label` records matches and applies the label.
 */
export type BotRuleMode = 'monitor' | 'label';
