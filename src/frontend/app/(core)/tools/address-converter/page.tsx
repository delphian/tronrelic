/**
 * @fileoverview Address converter tool route.
 *
 * Thin wrapper rendering the AddressConverter component with SEO metadata.
 * No SSR data — the tool is a user-driven interactive form.
 */

import type { Metadata } from 'next';
import { buildMetadata } from '../../../../lib/seo';
import { getServerConfig } from '../../../../lib/serverConfig';
import { AddressConverter } from '../../../../modules/tools';

/**
 * Generate SEO metadata targeting TRON address format conversion keywords.
 */
export async function generateMetadata(): Promise<Metadata> {
    const { siteUrl } = await getServerConfig();

    return buildMetadata({
        siteUrl,
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

export default function AddressConverterPage() {
    return <AddressConverter />;
}
