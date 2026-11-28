/**
 * @fileoverview The CMS page the tools module proposes for Address Origins.
 *
 * `/tools/address-origins` belongs to the CMS: no route in code serves that
 * address, so it answers 404 until this page exists. An admin creates it from
 * the Bootstrap tab of `/system/tools`, which proposes it through the pages
 * module, and a curator approves or rejects it on `/system/curation`. After
 * approval admins edit and translate it on `/system/pages`, and each language
 * is served only once the page has a published translation into it. Its slug
 * is only the default address.
 *
 * The title, description, keywords, heading, and intro line are the ones the
 * built-in page used, so the page reads the same to visitors and search
 * engines once it is approved. The tracer is embedded as a required widget.
 * Its reading guide, which warns what a chain does not prove, is part of the
 * widget, so editing the page text cannot remove it.
 */

import type { IPageProposal } from '@/types';
import { ADDRESS_ORIGINS_PATH, ADDRESS_ORIGINS_WIDGET_TYPE_ID } from '@/types';
import { buildRequiredWidgetEmbed } from './buildRequiredWidgetEmbed.js';

/**
 * Markdown body: a heading and an intro line, then the tracer. Opens with
 * the page's only `<h1>`, because the CMS route adds no heading of its own.
 */
const BODY = `# Address Origins

A TRON account only exists once another account pays to create it. Trace that chain back as far as the record goes.

${buildRequiredWidgetEmbed(ADDRESS_ORIGINS_WIDGET_TYPE_ID)}
`;

/**
 * The page the tools module proposes, in the shape `IPageService.proposePage`
 * accepts. `source` names the module as the actor in the curation queue.
 */
export const ADDRESS_ORIGINS_PAGE_PROPOSAL: IPageProposal & { slug: string } = {
    title: 'TRON Address Origins | Wallet Activation Tracer',
    slug: ADDRESS_ORIGINS_PATH,
    body: BODY,
    description: 'Trace any TRON wallet back through its chain of activator accounts to the account that created it, and reveal ancestors shared across multiple wallets.',
    keywords: [
        'TRON address origin',
        'TRON wallet activation',
        'TRON activator account',
        'TRON wallet provenance',
        'TRON address ancestry',
        'TRON wallet clustering',
        'trace TRON wallet funding',
        'TRON account creator'
    ],
    source: 'tools-module'
};
