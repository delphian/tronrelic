/**
 * @fileoverview Address generator tool route.
 *
 * Thin wrapper rendering the AddressGenerator component with SEO metadata.
 * No SSR data — the tool is a user-driven interactive form with in-browser
 * key generation via BIP39 mnemonic and vanity search.
 */

import type { Metadata } from 'next';
import { buildMetadata } from '../../../../../../lib/seo';
import { getServerConfig } from '../../../../../../lib/serverConfig';
import { translateKeywords } from '../../../../../../lib/translateKeywords';
import { getServerTranslator } from '../../../../../../modules/localization/server';
import { AddressGenerator } from '../../../../../../modules/tools';

/**
 * Generate SEO metadata targeting TRON address generation and vanity address keywords.
 *
 * @param props - Route props; `params.lang` selects the language the canonical URL uses.
 */
export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
    const [{ siteUrl }, { t, language }] = await Promise.all([getServerConfig(), getServerTranslator(params)]);

    return buildMetadata({
        siteUrl,
        language,
        title: t('tools.addressGenerator.meta.title', 'TRON Address Generator | Vanity Address & Wallet Creator'),
        description: t(
            'tools.addressGenerator.meta.description',
            'Generate TRON wallets with BIP39 recovery phrases entirely in your browser. Create vanity addresses with custom patterns. Private keys never leave your device.'
        ),
        path: '/tools/address-generator',
        keywords: translateKeywords(t, 'tools.addressGenerator.meta.keywords', [
            'TRON address generator',
            'TRON vanity address',
            'TRX wallet generator',
            'TRON wallet creator',
            'TRON BIP39 mnemonic',
            'TRON recovery phrase',
            'TRX vanity address search',
            'TRON offline wallet'
        ])
    });
}

export default function AddressGeneratorPage() {
    return <AddressGenerator />;
}
