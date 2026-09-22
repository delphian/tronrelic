'use client';

/**
 * @fileoverview The list of vendor configuration cards.
 *
 * Fetches the vendor registry once and renders one generic card per vendor
 * that does not carry its own bespoke card, in the backend's registration
 * order. Fetching the list here rather than in each card means one request
 * for the whole tab and a single place that knows the list endpoint exists.
 * This is admin configuration behind a user-opened tab, so the fetch on mount
 * follows the pattern every other card on the Configuration tab already uses.
 */

import { useEffect, useState } from 'react';
import { Card } from '../../../../../components/ui/Card';
import { listProviders, type IProviderView } from './providers-api';
import { ProviderVendorSection } from './ProviderVendorSection';

/**
 * Load the registry and render a card per generic vendor.
 *
 * @returns The vendor cards, or a loading / error line while none can be shown.
 */
export function ProviderVendorSections() {
    const [providers, setProviders] = useState<IProviderView[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        listProviders()
            .then((list) => {
                if (active) {
                    setProviders(list);
                }
            })
            .catch((err) => {
                if (active) {
                    setError(err instanceof Error ? err.message : 'Failed to load providers.');
                }
            });
        return () => {
            active = false;
        };
    }, []);

    if (error) {
        return <Card padding="sm" noBackgroundImage><span className="text-muted">{error}</span></Card>;
    }
    if (!providers) {
        return <Card padding="sm" noBackgroundImage><span className="text-muted">Loading provider configuration…</span></Card>;
    }
    return (
        <>
            {providers
                .filter((provider) => !provider.custom)
                .map((provider) => <ProviderVendorSection key={provider.id} provider={provider} />)}
        </>
    );
}
