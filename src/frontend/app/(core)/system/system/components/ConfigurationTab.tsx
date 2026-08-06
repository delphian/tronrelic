'use client';

/**
 * @fileoverview Configuration tab body.
 *
 * Groups the settings an operator edits at runtime — the site URL and the
 * external data providers that feed it — onto one tab, so configuration is a
 * single destination rather than a value hunted across sibling tabs.
 *
 * Each section keeps its own fetch/save lifecycle and its own controls: saving
 * the site URL must not push a provider's form state, and the provider section's
 * Test button acts on the saved provider config alone. New provider sections are
 * added here beside TronScan.
 */

import { Stack } from '../../../../../components/layout';
import { SectionPanel } from './SectionPanel';
import { SystemConfigSection } from './SystemConfigSection';
import { TronScanProviderSection } from './TronScanProviderSection';

/**
 * Render the Configuration tab.
 *
 * @returns The site-URL panel followed by the provider configuration cards.
 */
export function ConfigurationTab() {
    return (
        <Stack gap="sm">
            <SectionPanel>
                <SystemConfigSection />
            </SectionPanel>
            <TronScanProviderSection />
        </Stack>
    );
}
