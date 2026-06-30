'use client';

import { Stack } from '../../../../../components/layout';
import { TronScanProviderSection } from './TronScanProviderSection';

/**
 * Providers tab — runtime configuration for external data providers.
 *
 * A thin host so additional provider sections can be added beside TronScan
 * without touching the page shell. Each section owns its own fetch/save/test
 * lifecycle.
 *
 * @returns The providers configuration panel.
 */
export function ProvidersTab() {
    return (
        <Stack gap="md">
            <TronScanProviderSection />
        </Stack>
    );
}
