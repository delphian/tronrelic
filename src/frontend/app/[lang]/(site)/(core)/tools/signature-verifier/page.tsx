/**
 * @fileoverview Signature verifier tool route.
 *
 * Thin wrapper rendering the SignatureVerifier component with SEO metadata.
 * No SSR data — the tool is a user-driven interactive form. Supports URL
 * query parameters for direct linking: ?wallet=...&message=...&signature=...
 */

import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata } from '../../../../../../lib/seo';
import { getServerConfig } from '../../../../../../lib/serverConfig';
import { translateKeywords } from '../../../../../../lib/translateKeywords';
import { getServerTranslator } from '../../../../../../modules/localization/server';
import { SignatureVerifier } from '../../../../../../modules/tools';

/**
 * Generate SEO metadata targeting TRON signature verification keywords.
 *
 * @param props - Route props; `params.lang` selects the language the canonical URL uses.
 */
export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
    const [{ siteUrl }, { t, language }] = await Promise.all([getServerConfig(), getServerTranslator(params)]);

    return buildMetadata({
        siteUrl,
        language,
        title: t('tools.signatureVerifier.meta.title', 'TRON Signature Verifier | Verify TRX Signed Messages'),
        description: t(
            'tools.signatureVerifier.meta.description',
            'Verify TRON wallet signatures and signed messages. Confirm message authenticity and prove wallet ownership on the TRON blockchain.'
        ),
        path: '/tools/signature-verifier',
        keywords: translateKeywords(t, 'tools.signatureVerifier.meta.keywords', [
            'TRON signature verifier',
            'TRX signed message',
            'TRON wallet verification',
            'TRON message signing',
            'TRX signature checker',
            'TRON cryptographic proof',
            'verify TRON wallet ownership',
            'TronLink signature verify'
        ])
    });
}

/**
 * Wraps SignatureVerifier in Suspense because useSearchParams() requires it
 * in Next.js App Router when the page has no generateStaticParams.
 */
export default function SignatureVerifierPage() {
    return (
        <Suspense>
            <SignatureVerifier />
        </Suspense>
    );
}
