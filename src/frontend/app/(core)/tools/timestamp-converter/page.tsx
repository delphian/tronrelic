/**
 * @fileoverview Timestamp converter tool route.
 *
 * Thin wrapper rendering the TimestampConverter component with SEO metadata.
 * No SSR data — the tool is a user-driven interactive form.
 */

import type { Metadata } from 'next';
import { buildMetadata } from '../../../../lib/seo';
import { getServerConfig } from '../../../../lib/serverConfig';
import { TimestampConverter } from '../../../../modules/tools';

/**
 * Generate SEO metadata targeting TRON block/timestamp conversion keywords.
 */
export async function generateMetadata(): Promise<Metadata> {
    const { siteUrl } = await getServerConfig();

    return buildMetadata({
        siteUrl,
        title: 'TRON Block & Timestamp Converter | Epoch to Block Number',
        description: 'Convert between Unix timestamps, human-readable dates, and TRON block numbers. Bidirectional epoch converter with live block estimation.',
        path: '/tools/timestamp-converter',
        keywords: [
            'TRON block number converter',
            'TRON timestamp converter',
            'Unix epoch to TRON block',
            'TRON block to date',
            'TRON blockchain time',
            'epoch converter TRON',
            'TRX block explorer tool',
            'TRON block height calculator'
        ]
    });
}

export default function TimestampConverterPage() {
    return <TimestampConverter />;
}
