/**
 * @fileoverview Address converter tool route.
 *
 * Thin wrapper rendering the AddressConverter component with SEO metadata.
 * No SSR data — the tool is a user-driven interactive form.
 */

import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata } from '../../../../../../lib/seo';
import { getServerConfig } from '../../../../../../lib/serverConfig';
import { resolveMetadataLanguage } from '../../../../../../modules/localization/server';
import { AddressConverter } from '../../../../../../modules/tools';

/**
 * Generate SEO metadata targeting TRON address format conversion keywords.
 *
 * @param props - Route props; `params.lang` selects the language the canonical URL uses.
 */
export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
    const [{ siteUrl }, language] = await Promise.all([getServerConfig(), resolveMetadataLanguage(params)]);

    return buildMetadata({
        siteUrl,
        language,
        title: 'TRON Address Converter | Base58 to Hex & Hex to Base58',
        description: 'Convert TRON addresses between Base58 and Hex formats instantly. Validate address checksums and decode raw blockchain address formats.',
        path: '/tools/address-converter',
        keywords: [
            'TRON address converter',
            'TRX Base58 to hex',
            'TRON hex to Base58',
            'TRON address format',
            'TRX address decoder',
            'TRON checksum validator',
            'TRON address encoding',
            'TRX address hex converter'
        ]
    });
}

/**
 * Wraps AddressConverter in Suspense because it reads `useSearchParams()`
 * (to pre-fill a forwarded `?address=`), which Next.js App Router requires be
 * inside a Suspense boundary when the page has no generateStaticParams.
 */
export default function AddressConverterPage() {
    return (
        <Suspense>
            <AddressConverter />
        </Suspense>
    );
}
