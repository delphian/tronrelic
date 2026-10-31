/**
 * @fileoverview Barrel for the traffic domain contracts.
 *
 * Re-exports the published ignore-list contract, the campaign-tagging and
 * UTM-reading helpers, and the bot-rule contracts so the root types index can
 * surface them with explicit export lines.
 */

export type { ITrafficIgnoreSubject } from './ITrafficIgnoreSubject.js';
export type { ITrafficIgnoreList } from './ITrafficIgnoreList.js';
export type { ICampaignParams } from './ICampaignParams.js';
export type { IUtmParams } from './IUtmParams.js';
export { appendCampaignParams } from './appendCampaignParams.js';
export { readUtmParams } from './readUtmParams.js';
export { CAMPAIGN_MEDIUM_SOCIAL } from './CAMPAIGN_MEDIUM_SOCIAL.js';
export { SYNDICATION_CAMPAIGN } from './SYNDICATION_CAMPAIGN.js';
export type { BotRuleLabel } from './BotRuleLabel.js';
export type { BotRuleMode } from './BotRuleMode.js';
export type { BotRuleStatus } from './BotRuleStatus.js';
export type { BotRuleSource } from './BotRuleSource.js';
export type { IBotRuleNetworkMismatch } from './IBotRuleNetworkMismatch.js';
export type { IBotRuleConditions } from './IBotRuleConditions.js';
export type { IBotRule } from './IBotRule.js';
export type { IBotRuleInput } from './IBotRuleInput.js';
export type { IBotRulePreview } from './IBotRulePreview.js';
export type { IBotRulePreviewSample } from './IBotRulePreviewSample.js';
export type { IBotRuleStats } from './IBotRuleStats.js';
export type { IBotRuleSuggestion } from './IBotRuleSuggestion.js';
export { BOT_RULE_LABELS } from './BOT_RULE_LABELS.js';
