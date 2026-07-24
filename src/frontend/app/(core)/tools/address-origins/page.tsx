/**
 * @fileoverview Address Origins tool route.
 *
 * Thin wrapper rendering the AddressOrigins component with SEO metadata.
 * No SSR data — results stream in over SSE after the user acts.
 */

import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata } from '../../../../lib/seo';
import { getServerConfig } from '../../../../lib/serverConfig';
import { AddressOrigins } from '../../../../modules/tools';

/**
 * Generate SEO metadata targeting TRON address provenance and wallet-clustering keywords.
 */
export async function generateMetadata(): Promise<Metadata> {
    const { siteUrl } = await getServerConfig();

    return buildMetadata({
        siteUrl,
        title: 'TRON Address Origins | Wallet Activation Tracer',
        description: 'Trace any TRON wallet back through its chain of activator accounts to the account that created it, and reveal ancestors shared across multiple wallets.',
        path: '/tools/address-origins',
        keywords: [
            'TRON address origin',
            'TRON wallet activation',
            'TRON activator account',
            'TRON wallet provenance',
            'TRON address ancestry',
            'TRON wallet clustering',
            'trace TRON wallet funding',
            'TRON account creator'
        ]
    });
}

/**
 * Wraps AddressOrigins in Suspense because it reads `useSearchParams()` (to
 * pre-fill a forwarded `?address=` into the first wallet row), which Next.js
 * App Router requires be inside a Suspense boundary when the page has no
 * generateStaticParams.
 */
export default function AddressOriginsPage() {
    return (
        <Suspense>
            <AddressOrigins />
        </Suspense>
    );
}
