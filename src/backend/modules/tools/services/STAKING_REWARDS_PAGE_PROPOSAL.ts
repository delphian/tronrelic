/**
 * @fileoverview The CMS page the tools module proposes for the staking rewards calculator.
 *
 * An admin creates this page from the Bootstrap tab of `/system/tools`, which
 * proposes it through the pages module, and a curator approves or rejects it
 * on `/system/curation`. After approval admins edit and translate it on
 * `/system/pages`, which is how a language version can be written for that
 * language's own searches. Its slug is only the default address.
 *
 * Every visible field matches the built-in page the route serves until this
 * one is approved, so approving it changes no visible text. Keep these values
 * in step with the `t()` defaults in `StakingRewards.tsx` and the route's
 * metadata until this page is approved.
 */

import type { IPageProposal } from '@/types';
import { STAKING_REWARDS_PATH, STAKING_REWARDS_WIDGET_TYPE_ID, WIDGET_EMBED_MARKUP } from '@/types';

/**
 * The fenced block that embeds the calculator, written from the shared markup
 * constants so a change to the embed syntax cannot leave this page behind.
 */
const CALCULATOR_EMBED = [
    '```' + WIDGET_EMBED_MARKUP.fenceLanguage,
    JSON.stringify({ type: STAKING_REWARDS_WIDGET_TYPE_ID, config: {} }),
    '```'
].join('\n');

/**
 * Markdown body: the built-in page's heading and intro line, then the
 * calculator. Opens with the page's only `<h1>`, because the CMS route adds
 * no heading of its own.
 */
const BODY = `# Staking Rewards Calculator

Estimate the TRX you earn each year by voting with staked TRX, through each Super Representative after its commission

${CALCULATOR_EMBED}
`;

/**
 * The page the tools module proposes, in the shape `IPageService.proposePage`
 * accepts. `source` names the module as the actor in the curation queue.
 */
export const STAKING_REWARDS_PAGE_PROPOSAL: IPageProposal & { slug: string } = {
    title: 'TRON Staking Rewards Calculator | TRX Voting Rewards by Super Representative',
    slug: STAKING_REWARDS_PATH,
    body: BODY,
    description: 'Estimate yearly TRX rewards from staking and voting on TRON. Compare every Super Representative by commission and reward rate, from live on-chain figures.',
    keywords: [
        'TRON staking rewards calculator',
        'TRX staking rewards',
        'TRX staking APR',
        'TRON voting rewards',
        'Super Representative rewards',
        'TRON SR commission',
        'TRX staking calculator',
        'TRON Stake 2.0 rewards'
    ],
    source: 'tools-module'
};
