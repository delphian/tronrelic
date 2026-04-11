/**
 * @fileoverview Signature verifier tool route.
 *
 * Thin wrapper rendering the SignatureVerifier component with SEO metadata.
 * No SSR data — the tool is a user-driven interactive form. Supports URL
 * query parameters for direct linking: ?wallet=...&message=...&signature=...
 */

import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata } from '../../../../lib/seo';
import { getServerConfig } from '../../../../lib/serverConfig';
import { SignatureVerifier } from '../../../../modules/tools';

/**
 * Generate SEO metadata targeting TRON signature verification keywords.
 */
export async function generateMetadata(): Promise<Metadata> {
    const { siteUrl } = await getServerConfig();

    return buildMetadata({
        siteUrl,
        title: 'TRON Signature Verifier | Verify TRX Signed Messages',
        description: 'Verify TRON wallet signatures and signed messages. Confirm message authenticity and prove wallet ownership on the TRON blockchain.',
        path: '/tools/signature-verifier',
        keywords: [
            'TRON signature verifier',
            'TRX signed message',
            'TRON wallet verification',
            'TRON message signing',
            'TRX signature checker',
            'TRON cryptographic proof',
            'verify TRON wallet ownership',
            'TronLink signature verify'
        ]
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
