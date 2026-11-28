/**
 * @fileoverview The CMS page the tools module proposes for the energy estimator.
 *
 * `/tools/energy-estimator` belongs to the CMS: no route in code serves that
 * address, so it answers 404 until this page exists. An admin creates it from
 * the Bootstrap tab of `/system/tools`, which proposes it through the pages
 * module, and a curator approves or rejects it on `/system/curation`. After
 * approval admins edit and translate it on `/system/pages`, and each language
 * is served only once the page has a published translation into it. Its slug
 * is only the default address.
 *
 * The title, description, keywords, heading, and intro line are the ones the
 * built-in page used, so the page reads the same to visitors and search
 * engines once it is approved. The estimator is embedded as a required widget.
 */

import type { IPageProposal } from '@/types';
import { ENERGY_ESTIMATOR_PATH, ENERGY_ESTIMATOR_WIDGET_TYPE_ID } from '@/types';
import { buildRequiredWidgetEmbed } from './buildRequiredWidgetEmbed.js';

/**
 * Markdown body: a heading and an intro line, then the estimator. Opens with
 * the page's only `<h1>`, because the CMS route adds no heading of its own.
 */
const BODY = `# Energy Estimator

Estimate daily energy requirements and compare staking with burning TRX for fees

${buildRequiredWidgetEmbed(ENERGY_ESTIMATOR_WIDGET_TYPE_ID)}
`;

/**
 * The page the tools module proposes, in the shape `IPageService.proposePage`
 * accepts. `source` names the module as the actor in the curation queue.
 */
export const ENERGY_ESTIMATOR_PAGE_PROPOSAL: IPageProposal & { slug: string } = {
    title: 'TRON Energy Estimator | TRX Transaction Cost Calculator',
    slug: ENERGY_ESTIMATOR_PATH,
    body: BODY,
    description: 'Estimate energy costs for TRON transactions before sending. Calculate TRX fees for USDT transfers, smart contract calls, and TRC20 token operations.',
    keywords: [
        'TRON energy estimator',
        'TRX transaction cost',
        'TRON energy calculator',
        'USDT transfer cost',
        'TRC20 energy cost',
        'TRON fee calculator',
        'TRX gas estimator',
        'TRON smart contract cost'
    ],
    source: 'tools-module'
};
