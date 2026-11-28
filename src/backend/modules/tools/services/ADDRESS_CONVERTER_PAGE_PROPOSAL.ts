/**
 * @fileoverview The CMS page the tools module proposes for the address converter.
 *
 * `/tools/address-converter` belongs to the CMS: no route in code serves that
 * address, so it answers 404 until this page exists. An admin creates it from
 * the Bootstrap tab of `/system/tools`, which proposes it through the pages
 * module, and a curator approves or rejects it on `/system/curation`. After
 * approval admins edit and translate it on `/system/pages`, and each language
 * is served only once the page has a published translation into it. Its slug
 * is only the default address.
 *
 * The title, description, keywords, heading, and intro line are the ones the
 * built-in page used, so the page reads the same to visitors and search
 * engines once it is approved. The converter is embedded as a required widget,
 * and still pre-fills from the `?address=` value the address chip menu sends.
 */

import type { IPageProposal } from '@/types';
import { ADDRESS_CONVERTER_PATH, ADDRESS_CONVERTER_WIDGET_TYPE_ID } from '@/types';
import { buildRequiredWidgetEmbed } from './buildRequiredWidgetEmbed.js';

/**
 * Markdown body: a heading and an intro line, then the converter. Opens with
 * the page's only `<h1>`, because the CMS route adds no heading of its own.
 */
const BODY = `# Address Converter

Convert between TRON hex and base58check formats

${buildRequiredWidgetEmbed(ADDRESS_CONVERTER_WIDGET_TYPE_ID)}
`;

/**
 * The page the tools module proposes, in the shape `IPageService.proposePage`
 * accepts. `source` names the module as the actor in the curation queue.
 */
export const ADDRESS_CONVERTER_PAGE_PROPOSAL: IPageProposal & { slug: string } = {
    title: 'TRON Address Converter | Base58 to Hex & Hex to Base58',
    slug: ADDRESS_CONVERTER_PATH,
    body: BODY,
    description: 'Convert TRON addresses between Base58 and Hex formats instantly. Validate address checksums and decode raw blockchain address formats.',
    keywords: [
        'TRON address converter',
        'TRX Base58 to hex',
        'TRON hex to Base58',
        'TRON address format',
        'TRX address decoder',
        'TRON checksum validator',
        'TRON address encoding',
        'TRX address hex converter'
    ],
    source: 'tools-module'
};
