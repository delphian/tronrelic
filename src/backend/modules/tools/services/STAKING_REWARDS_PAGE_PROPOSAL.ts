/**
 * @fileoverview The CMS page the tools module proposes for the staking rewards calculator.
 *
 * `/tools/staking-rewards` belongs to the CMS: no route in code serves that
 * address, so it answers 404 until this page exists. An admin creates it from
 * the Bootstrap tab of `/system/tools`, which proposes it through the pages
 * module, and a curator approves or rejects it on `/system/curation`. After
 * approval admins edit and translate it on `/system/pages`, which is how a
 * language version can be written for that language's own searches, and each
 * language is served only once the page has a published translation into it.
 * Its slug is only the default address.
 *
 * The body embeds the calculator as a required widget, so the pages module
 * describes the page as a `WebApplication` in its structured data. The widget
 * type is core and always registered, so the flag never withholds the page.
 * The widget's own server-side fetcher supplies the rewards snapshot.
 */

import type { IPageProposal } from '@/types';
import { STAKING_REWARDS_PATH, STAKING_REWARDS_WIDGET_TYPE_ID } from '@/types';
import { buildRequiredWidgetEmbed } from './buildRequiredWidgetEmbed.js';

/** The fenced block that embeds the calculator as a required widget. */
const CALCULATOR_EMBED = buildRequiredWidgetEmbed(STAKING_REWARDS_WIDGET_TYPE_ID);

/**
 * Markdown body: a heading and an intro line, then the calculator. Opens with
 * the page's only `<h1>`, because the CMS route adds no heading of its own.
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
