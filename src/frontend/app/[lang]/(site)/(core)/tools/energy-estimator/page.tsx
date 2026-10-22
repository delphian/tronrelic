/**
 * @fileoverview Energy estimator tool route.
 *
 * Thin wrapper rendering the EnergyEstimator component with SEO metadata.
 * No SSR data — the tool is a user-driven interactive form.
 */

import type { Metadata } from 'next';
import { buildMetadata } from '../../../../../../lib/seo';
import { getServerConfig } from '../../../../../../lib/serverConfig';
import { translateKeywords } from '../../../../../../lib/translateKeywords';
import { getServerTranslator } from '../../../../../../modules/localization/server';
import { EnergyEstimator } from '../../../../../../modules/tools';

/**
 * Generate SEO metadata targeting TRON energy cost estimation keywords.
 *
 * @param props - Route props; `params.lang` selects the language the canonical URL uses.
 */
export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
    const [{ siteUrl }, { t, language }] = await Promise.all([getServerConfig(), getServerTranslator(params)]);

    return buildMetadata({
        siteUrl,
        language,
        title: t('tools.energyEstimator.meta.title', 'TRON Energy Estimator | TRX Transaction Cost Calculator'),
        description: t(
            'tools.energyEstimator.meta.description',
            'Estimate energy costs for TRON transactions before sending. Calculate TRX fees for USDT transfers, smart contract calls, and TRC20 token operations.'
        ),
        path: '/tools/energy-estimator',
        keywords: translateKeywords(t, 'tools.energyEstimator.meta.keywords', [
            'TRON energy estimator',
            'TRX transaction cost',
            'TRON energy calculator',
            'USDT transfer cost',
            'TRC20 energy cost',
            'TRON fee calculator',
            'TRX gas estimator',
            'TRON smart contract cost'
        ])
    });
}

export default function EnergyEstimatorPage() {
    return <EnergyEstimator />;
}
