/**
 * @fileoverview Token approval checker tool route.
 *
 * Thin wrapper rendering the ApprovalChecker component with SEO metadata.
 * No SSR data — the tool is a user-driven interactive form.
 */

import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata } from '../../../../../../lib/seo';
import { getServerConfig } from '../../../../../../lib/serverConfig';
import { getServerTranslator } from '../../../../../../modules/localization/server';
import { ApprovalChecker } from '../../../../../../modules/tools';

/**
 * Generate SEO metadata targeting TRON token approval and wallet security keywords.
 *
 * @param props - Route props; `params.lang` selects the language the canonical URL uses.
 */
export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
    const [{ siteUrl }, { t, language }] = await Promise.all([getServerConfig(), getServerTranslator(params)]);

    return buildMetadata({
        siteUrl,
        language,
        title: t('tools.approvalChecker.meta.title', 'TRON Token Approval Checker | TRC20 Allowance Scanner'),
        description: t(
            'tools.approvalChecker.meta.description',
            'Scan any TRON wallet for active TRC20 token approvals. Find unlimited allowances, revoke risks, and spender contracts on the TRON blockchain.'
        ),
        path: '/tools/approval-checker',
        keywords: [
            'TRON approval checker',
            'TRC20 allowance scanner',
            'TRON token approvals',
            'TRC20 spender checker',
            'TRON wallet security',
            'token allowance checker',
            'TRON smart contract approvals',
            'TRX token permissions'
        ]
    });
}

/**
 * Wraps ApprovalChecker in Suspense because it reads `useSearchParams()` (to
 * pre-fill a forwarded `?address=`), which Next.js App Router requires be
 * inside a Suspense boundary when the page has no generateStaticParams.
 */
export default function ApprovalCheckerPage() {
    return (
        <Suspense>
            <ApprovalChecker />
        </Suspense>
    );
}
