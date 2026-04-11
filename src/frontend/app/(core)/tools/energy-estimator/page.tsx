/**
 * @fileoverview Energy estimator tool route.
 *
 * Thin wrapper rendering the EnergyEstimator component with SEO metadata.
 * No SSR data — the tool is a user-driven interactive form.
 */

import type { Metadata } from 'next';
import { buildMetadata } from '../../../../lib/seo';
import { getServerConfig } from '../../../../lib/serverConfig';
import { EnergyEstimator } from '../../../../modules/tools';

/**
 * Generate SEO metadata targeting TRON energy cost estimation keywords.
 */
export async function generateMetadata(): Promise<Metadata> {
    const { siteUrl } = await getServerConfig();

    return buildMetadata({
        siteUrl,
        title: 'TRON Energy Estimator | TRX Transaction Cost Calculator',
        description: 'Estimate energy costs for TRON transactions before sending. Calculate TRX fees for USDT transfers, smart contract calls, and TRC20 token operations.',
        path: '/tools/energy-estimator',
        keywords: [
            'TRON energy estimator',
            'TRX transaction cost',
            'TRON energy calculator',
            'USDT transfer cost',
            'TRC20 energy cost',
            'TRON fee calculator',
            'TRX gas estimator',
            'TRON smart contract cost'
        ]
    });
}

export default function EnergyEstimatorPage() {
    return <EnergyEstimator />;
}
