/**
 * @fileoverview The CMS page the tools module proposes for the stake calculator.
 *
 * `/tools/stake-calculator` belongs to the CMS: no route in code serves that
 * address, so it answers 404 until this page exists. An admin creates it from
 * the Bootstrap tab of `/system/tools`, which proposes it through the pages
 * module, and a curator approves or rejects it on `/system/curation`. After
 * approval the page belongs to the admins, who edit and translate it on
 * `/system/pages` like any other page, and each language is served only once
 * the page has a published translation into it. Its slug is only the default
 * address: an admin may move it, and the CMS then redirects the old address.
 *
 * The body embeds the calculator as a required widget. The pages module
 * describes a page with a required embed as a `WebApplication` in its
 * structured data, because the page is that widget's tool page. The widget
 * type is core and always registered, so the flag never withholds the page.
 */

import type { IPageProposal } from '@/types';
import { STAKE_CALCULATOR_PATH, STAKE_CALCULATOR_WIDGET_TYPE_ID } from '@/types';
import { buildRequiredWidgetEmbed } from './buildRequiredWidgetEmbed.js';

/** The fenced block that embeds the calculator as a required widget. */
const CALCULATOR_EMBED = buildRequiredWidgetEmbed(STAKE_CALCULATOR_WIDGET_TYPE_ID);

/**
 * Markdown body of the proposed page: a heading, an intro line, then the
 * calculator. Opens with the page's only `<h1>`, because the CMS route renders
 * the body as the whole page and adds no heading of its own.
 */
const BODY = `# Stake Calculator

Calculate energy from TRX or TRX from energy using live network parameters

${CALCULATOR_EMBED}
`;

/**
 * The page the tools module proposes, in the shape `IPageService.proposePage`
 * accepts. `source` names the module as the actor in the curation queue, so a
 * curator can see the page came from the tools module and not from a person
 * or an AI tool.
 */
export const STAKE_CALCULATOR_PAGE_PROPOSAL: IPageProposal & { slug: string } = {
    title: 'TRON Stake Calculator | TRX Staking Energy & Bandwidth Yield',
    slug: STAKE_CALCULATOR_PATH,
    body: BODY,
    description: 'Calculate energy and bandwidth yield from staking TRX on the TRON network. Compare staking returns against renting energy from delegation markets.',
    keywords: [
        'TRON stake calculator',
        'TRX staking yield',
        'TRON energy staking',
        'TRX bandwidth calculator',
        'TRON staking returns',
        'TRX freeze calculator',
        'TRON Stake 2.0',
        'TRX energy vs rent'
    ],
    source: 'tools-module'
};
