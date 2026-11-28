/**
 * @fileoverview The CMS page the tools module proposes for the token approval checker.
 *
 * `/tools/approval-checker` belongs to the CMS: no route in code serves that
 * address, so it answers 404 until this page exists. An admin creates it from
 * the Bootstrap tab of `/system/tools`, which proposes it through the pages
 * module, and a curator approves or rejects it on `/system/curation`. After
 * approval admins edit and translate it on `/system/pages`, and each language
 * is served only once the page has a published translation into it. Its slug
 * is only the default address.
 *
 * The title, description, keywords, heading, and intro line are the ones the
 * built-in page used, so the page reads the same to visitors and search
 * engines once it is approved. The checker is embedded as a required widget;
 * it still shows a sign-in note to signed-out visitors and pre-fills from the
 * `?address=` value the address chip menu sends.
 */

import type { IPageProposal } from '@/types';
import { APPROVAL_CHECKER_PATH, APPROVAL_CHECKER_WIDGET_TYPE_ID } from '@/types';
import { buildRequiredWidgetEmbed } from './buildRequiredWidgetEmbed.js';

/**
 * Markdown body: a heading and an intro line, then the checker. Opens with
 * the page's only `<h1>`, because the CMS route adds no heading of its own.
 */
const BODY = `# Token Approval Checker

Scan a TRON wallet for active TRC20 token approvals

${buildRequiredWidgetEmbed(APPROVAL_CHECKER_WIDGET_TYPE_ID)}
`;

/**
 * The page the tools module proposes, in the shape `IPageService.proposePage`
 * accepts. `source` names the module as the actor in the curation queue.
 */
export const APPROVAL_CHECKER_PAGE_PROPOSAL: IPageProposal & { slug: string } = {
    title: 'TRON Token Approval Checker | TRC20 Allowance Scanner',
    slug: APPROVAL_CHECKER_PATH,
    body: BODY,
    description: 'Scan any TRON wallet for active TRC20 token approvals. Find unlimited allowances, revoke risks, and spender contracts on the TRON blockchain.',
    keywords: [
        'TRON approval checker',
        'TRC20 allowance scanner',
        'TRON token approvals',
        'TRC20 spender checker',
        'TRON wallet security',
        'token allowance checker',
        'TRON smart contract approvals',
        'TRX token permissions'
    ],
    source: 'tools-module'
};
