'use client';

/**
 * @fileoverview Configuration tab body.
 *
 * Groups the settings an operator edits at runtime — the site URL, the header's
 * sign-in button image, the pacing of the block feed, and the external data
 * vendors that feed it — onto one tab, so configuration is a single
 * destination rather than a value hunted across sibling tabs.
 *
 * Each section keeps its own fetch/save lifecycle and its own controls: saving
 * the site URL must not push a vendor's form state, and a vendor card's Test
 * button acts on that vendor's saved config alone. The site URL, the sign-in
 * button image, and the emit buffer share one database document but send
 * disjoint sets of fields, so no card's save can overwrite another's values.
 * Vendor cards render from the backend registry, so a vendor declared there
 * appears here without a change to this file; TronGrid keeps a bespoke card
 * for its rotating key pool.
 */

import { Stack } from '../../../../../components/layout';
import { SectionPanel } from './SectionPanel';
import { SystemConfigSection } from './SystemConfigSection';
import { AuthButtonImageSection } from './AuthButtonImageSection';
import { EmitBufferSection } from './EmitBufferSection';
import { ProviderVendorSections } from './ProviderVendorSections';
import { TronGridProviderSection } from './TronGridProviderSection';

/**
 * Render the Configuration tab.
 *
 * @returns The site-URL panel, the sign-in button image card, the block feed
 *          buffer card, and the vendor configuration cards.
 */
export function ConfigurationTab() {
    return (
        <Stack gap="lg">
            <SectionPanel>
                <SystemConfigSection />
            </SectionPanel>
            <AuthButtonImageSection />
            <EmitBufferSection />
            <ProviderVendorSections />
            <TronGridProviderSection />
        </Stack>
    );
}
