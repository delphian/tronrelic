/**
 * @fileoverview Stake calculator tool route.
 *
 * Thin wrapper rendering the StakeCalculator component with SEO metadata.
 * No SSR data — the tool is a user-driven interactive form.
 */

import type { Metadata } from 'next';
import { buildMetadata } from '../../../../../../lib/seo';
import { getServerConfig } from '../../../../../../lib/serverConfig';
import { resolveMetadataLanguage } from '../../../../../../modules/localization/server';
import { StakeCalculator } from '../../../../../../modules/tools';

/**
 * Generate SEO metadata targeting TRON staking and energy yield keywords.
 *
 * @param props - Route props; `params.lang` selects the language the canonical URL uses.
 */
export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
    const [{ siteUrl }, language] = await Promise.all([getServerConfig(), resolveMetadataLanguage(params)]);

    return buildMetadata({
        siteUrl,
        language,
        title: 'TRON Stake Calculator | TRX Staking Energy & Bandwidth Yield',
        description: 'Calculate energy and bandwidth yield from staking TRX on the TRON network. Compare staking returns against renting energy from delegation markets.',
        path: '/tools/stake-calculator',
        keywords: [
            'TRON stake calculator',
            'TRX staking yield',
            'TRON energy staking',
            'TRX bandwidth calculator',
            'TRON staking returns',
            'TRX freeze calculator',
            'TRON Stake 2.0',
            'TRX energy vs rent'
        ]
    });
}

export default function StakeCalculatorPage() {
    return <StakeCalculator />;
}
