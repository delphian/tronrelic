/**
 * @fileoverview The CMS page the tools module proposes for the address generator.
 *
 * `/tools/address-generator` belongs to the CMS: no route in code serves that
 * address, so it answers 404 until this page exists. An admin creates it from
 * the Bootstrap tab of `/system/tools`, which proposes it through the pages
 * module, and a curator approves or rejects it on `/system/curation`. After
 * approval admins edit and translate it on `/system/pages`, and each language
 * is served only once the page has a published translation into it. Its slug
 * is only the default address.
 *
 * The title, description, keywords, heading, and intro line are the ones the
 * built-in page used, so the page reads the same to visitors and search
 * engines once it is approved. The generator is embedded as a required widget;
 * its notice that keys never leave the browser is part of the widget, so an
 * edit to the page text cannot remove it.
 */

import type { IPageProposal } from '@/types';
import { ADDRESS_GENERATOR_PATH, ADDRESS_GENERATOR_WIDGET_TYPE_ID } from '@/types';
import { buildRequiredWidgetEmbed } from './buildRequiredWidgetEmbed.js';

/**
 * Markdown body: a heading and an intro line, then the generator. Opens with
 * the page's only `<h1>`, because the CMS route adds no heading of its own.
 */
const BODY = `# Address Generator

Generate random TRON addresses and search for vanity patterns

${buildRequiredWidgetEmbed(ADDRESS_GENERATOR_WIDGET_TYPE_ID)}
`;

/**
 * The page the tools module proposes, in the shape `IPageService.proposePage`
 * accepts. `source` names the module as the actor in the curation queue.
 */
export const ADDRESS_GENERATOR_PAGE_PROPOSAL: IPageProposal & { slug: string } = {
    title: 'TRON Address Generator | Vanity Address & Wallet Creator',
    slug: ADDRESS_GENERATOR_PATH,
    body: BODY,
    description: 'Generate TRON wallets with BIP39 recovery phrases entirely in your browser. Create vanity addresses with custom patterns. Private keys never leave your device.',
    keywords: [
        'TRON address generator',
        'TRON vanity address',
        'TRX wallet generator',
        'TRON wallet creator',
        'TRON BIP39 mnemonic',
        'TRON recovery phrase',
        'TRX vanity address search',
        'TRON offline wallet'
    ],
    source: 'tools-module'
};
