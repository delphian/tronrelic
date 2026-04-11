/**
 * @fileoverview Address generator tool route.
 *
 * Thin wrapper rendering the AddressGenerator component with SEO metadata.
 * No SSR data — the tool is a user-driven interactive form with in-browser
 * key generation via BIP39 mnemonic and vanity search.
 */

import type { Metadata } from 'next';
import { buildMetadata } from '../../../../lib/seo';
import { getServerConfig } from '../../../../lib/serverConfig';
import { AddressGenerator } from '../../../../modules/tools';

/**
 * Generate SEO metadata targeting TRON address generation and vanity address keywords.
 */
export async function generateMetadata(): Promise<Metadata> {
    const { siteUrl } = await getServerConfig();

    return buildMetadata({
        siteUrl,
        title: 'TRON Address Generator | Vanity Address & Wallet Creator',
        description: 'Generate TRON wallets with BIP39 recovery phrases entirely in your browser. Create vanity addresses with custom patterns. Private keys never leave your device.',
        path: '/tools/address-generator',
        keywords: [
            'TRON address generator',
            'TRON vanity address',
            'TRX wallet generator',
            'TRON wallet creator',
            'TRON BIP39 mnemonic',
            'TRON recovery phrase',
            'TRX vanity address search',
            'TRON offline wallet'
        ]
    });
}

export default function AddressGeneratorPage() {
    return <AddressGenerator />;
}
