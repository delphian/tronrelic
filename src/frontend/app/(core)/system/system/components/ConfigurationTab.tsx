'use client';

/**
 * @fileoverview Configuration tab body.
 *
 * Groups the settings an operator edits at runtime — the site URL, the pacing of
 * the block feed, and the external data providers that feed it — onto one tab,
 * so configuration is a single destination rather than a value hunted across
 * sibling tabs.
 *
 * Each section keeps its own fetch/save lifecycle and its own controls: saving
 * the site URL must not push a provider's form state, and the provider section's
 * Test button acts on the saved provider config alone. The site URL and the emit
 * buffer share one database document but send disjoint sets of fields, so
 * neither card's save can overwrite the other's values. New provider sections
 * are added here beside TronScan.
 */

import { Stack } from '../../../../../components/layout';
import { SectionPanel } from './SectionPanel';
import { SystemConfigSection } from './SystemConfigSection';
import { EmitBufferSection } from './EmitBufferSection';
import { TronScanProviderSection } from './TronScanProviderSection';
import { TronGridProviderSection } from './TronGridProviderSection';

/**
 * Render the Configuration tab.
 *
 * @returns The site-URL panel, the block feed buffer card, and the provider
 *          configuration cards.
 */
export function ConfigurationTab() {
    return (
        <Stack gap="lg">
            <SectionPanel>
                <SystemConfigSection />
            </SectionPanel>
            <EmitBufferSection />
            <TronScanProviderSection />
            <TronGridProviderSection />
        </Stack>
    );
}
