/**
 * @fileoverview The CMS page the tools module proposes for the stake calculator.
 *
 * The calculator's page used to be fixed in code, so its text and search
 * metadata could only change with a deploy. An admin now creates this page
 * from the Bootstrap tab of `/system/tools`, which proposes it through the
 * pages module, and a curator approves or rejects it on `/system/curation`.
 * After approval the page belongs to the admins, who edit and translate it on
 * `/system/pages` like any other page. Its slug is only the default address:
 * an admin may move it, and the CMS then redirects the old address.
 *
 * Every field a visitor or search engine can see matches the built-in page
 * the route serves until this one is approved: the same title, description,
 * and keywords, and a body with the same heading and intro line followed by
 * the calculator. Approving the page therefore changes no visible text; admins
 * add or change text afterwards through the CMS. The body embeds the
 * calculator with a ` ```widget ` block, so the form renders where the block
 * sits. Keep these values in step with the built-in page's `t()` defaults in
 * `StakeCalculator.tsx` and the route's metadata until this page is approved.
 */

import type { IPageProposal } from '@/types';
import { STAKE_CALCULATOR_PATH, STAKE_CALCULATOR_WIDGET_TYPE_ID, WIDGET_EMBED_MARKUP } from '@/types';

/**
 * The fenced block that embeds the calculator. Written from the shared markup
 * constants so a change to the embed syntax cannot leave this page behind.
 */
const CALCULATOR_EMBED = [
    '```' + WIDGET_EMBED_MARKUP.fenceLanguage,
    JSON.stringify({ type: STAKE_CALCULATOR_WIDGET_TYPE_ID, config: {} }),
    '```'
].join('\n');

/**
 * Markdown body of the proposed page: the built-in page's heading and intro
 * line, then the calculator. Opens with the page's only `<h1>`, because the
 * CMS route renders the body as the whole page and adds no heading of its own.
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
