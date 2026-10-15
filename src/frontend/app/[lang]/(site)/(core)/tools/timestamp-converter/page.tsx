/**
 * @fileoverview Timestamp converter tool route.
 *
 * Thin wrapper rendering the TimestampConverter component with SEO metadata.
 * No SSR data — the tool is a user-driven interactive form.
 */

import type { Metadata } from 'next';
import { buildMetadata } from '../../../../../../lib/seo';
import { getServerConfig } from '../../../../../../lib/serverConfig';
import { resolveMetadataLanguage } from '../../../../../../modules/localization/server';
import { TimestampConverter } from '../../../../../../modules/tools';

/**
 * Generate SEO metadata targeting TRON block/timestamp conversion keywords.
 *
 * @param props - Route props; `params.lang` selects the language the canonical URL uses.
 */
export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
    const [{ siteUrl }, language] = await Promise.all([getServerConfig(), resolveMetadataLanguage(params)]);

    return buildMetadata({
        siteUrl,
        language,
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
