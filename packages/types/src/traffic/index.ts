/**
 * @fileoverview Barrel for the traffic domain contracts.
 *
 * Re-exports the published ignore-list contract and the campaign-tagging
 * helper so the root types index can surface them with explicit export lines.
 */

export type { ITrafficIgnoreSubject } from './ITrafficIgnoreSubject.js';
export type { ITrafficIgnoreList } from './ITrafficIgnoreList.js';
export type { ICampaignParams } from './ICampaignParams.js';
export { appendCampaignParams } from './appendCampaignParams.js';
export { CAMPAIGN_MEDIUM_SOCIAL } from './CAMPAIGN_MEDIUM_SOCIAL.js';
export { SYNDICATION_CAMPAIGN } from './SYNDICATION_CAMPAIGN.js';
