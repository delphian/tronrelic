/**
 * @fileoverview The CMS page the tools module proposes for the timestamp converter.
 *
 * `/tools/timestamp-converter` belongs to the CMS: no route in code serves
 * that address, so it answers 404 until this page exists. An admin creates it
 * from the Bootstrap tab of `/system/tools`, which proposes it through the
 * pages module, and a curator approves or rejects it on `/system/curation`.
 * After approval admins edit and translate it on `/system/pages`, and each
 * language is served only once the page has a published translation into it.
 * Its slug is only the default address.
 *
 * The title, description, keywords, heading, and intro line are the ones the
 * built-in page used, so the page reads the same to visitors and search
 * engines once it is approved. The converter is embedded as a required widget.
 */

import type { IPageProposal } from '@/types';
import { TIMESTAMP_CONVERTER_PATH, TIMESTAMP_CONVERTER_WIDGET_TYPE_ID } from '@/types';
import { buildRequiredWidgetEmbed } from './buildRequiredWidgetEmbed.js';

/**
 * Markdown body: a heading and an intro line, then the converter. Opens with
 * the page's only `<h1>`, because the CMS route adds no heading of its own.
 */
const BODY = `# Timestamp Converter

Convert between Unix timestamps, dates, and TRON block numbers

${buildRequiredWidgetEmbed(TIMESTAMP_CONVERTER_WIDGET_TYPE_ID)}
`;

/**
 * The page the tools module proposes, in the shape `IPageService.proposePage`
 * accepts. `source` names the module as the actor in the curation queue.
 */
export const TIMESTAMP_CONVERTER_PAGE_PROPOSAL: IPageProposal & { slug: string } = {
    title: 'TRON Block & Timestamp Converter | Epoch to Block Number',
    slug: TIMESTAMP_CONVERTER_PATH,
    body: BODY,
    description: 'Convert between Unix timestamps, human-readable dates, and TRON block numbers. Bidirectional epoch converter with live block estimation.',
    keywords: [
        'TRON block number converter',
        'TRON timestamp converter',
        'Unix epoch to TRON block',
        'TRON block to date',
        'TRON blockchain time',
        'epoch converter TRON',
        'TRX block explorer tool',
        'TRON block height calculator'
    ],
    source: 'tools-module'
};
