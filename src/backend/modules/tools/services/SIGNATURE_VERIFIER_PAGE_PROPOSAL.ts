/**
 * @fileoverview The CMS page the tools module proposes for the signature verifier.
 *
 * `/tools/signature-verifier` belongs to the CMS: no route in code serves that
 * address, so it answers 404 until this page exists. An admin creates it from
 * the Bootstrap tab of `/system/tools`, which proposes it through the pages
 * module, and a curator approves or rejects it on `/system/curation`. After
 * approval admins edit and translate it on `/system/pages`, and each language
 * is served only once the page has a published translation into it. Its slug
 * is only the default address.
 *
 * The title, description, keywords, heading, and intro line are the ones the
 * built-in page used, so the page reads the same to visitors and search
 * engines once it is approved. The verifier is embedded as a required widget,
 * and a link carrying `?wallet=`, `?message=`, and `?signature=` still fills
 * the form and verifies on load.
 */

import type { IPageProposal } from '@/types';
import { SIGNATURE_VERIFIER_PATH, SIGNATURE_VERIFIER_WIDGET_TYPE_ID } from '@/types';
import { buildRequiredWidgetEmbed } from './buildRequiredWidgetEmbed.js';

/**
 * Markdown body: a heading and an intro line, then the verifier. Opens with
 * the page's only `<h1>`, because the CMS route adds no heading of its own.
 */
const BODY = `# Signature Verifier

Verify a TRON wallet signed a specific message

${buildRequiredWidgetEmbed(SIGNATURE_VERIFIER_WIDGET_TYPE_ID)}
`;

/**
 * The page the tools module proposes, in the shape `IPageService.proposePage`
 * accepts. `source` names the module as the actor in the curation queue.
 */
export const SIGNATURE_VERIFIER_PAGE_PROPOSAL: IPageProposal & { slug: string } = {
    title: 'TRON Signature Verifier | Verify TRX Signed Messages',
    slug: SIGNATURE_VERIFIER_PATH,
    body: BODY,
    description: 'Verify TRON wallet signatures and signed messages. Confirm message authenticity and prove wallet ownership on the TRON blockchain.',
    keywords: [
        'TRON signature verifier',
        'TRX signed message',
        'TRON wallet verification',
        'TRON message signing',
        'TRX signature checker',
        'TRON cryptographic proof',
        'verify TRON wallet ownership',
        'TronLink signature verify'
    ],
    source: 'tools-module'
};
