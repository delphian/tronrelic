'use client';

import { Settings, Radio, Database } from 'lucide-react';
import { Page, PageHeader, Stack } from '../../../../components/layout';
import { useSystemAuth } from '../../../../features/system';
import { CollapsibleSection } from './components/CollapsibleSection';
import { SystemConfigSection } from './components/SystemConfigSection';
import { WebSocketsSection } from './components/WebSocketsSection';
import { DatabaseSection } from './components/DatabaseSection';

/**
 * Consolidated System admin page.
 *
 * First entry in the admin nav. Replaces the separate Config, WebSockets,
 * and Database pages with three collapsible sections that share the same
 * layout primitives, semantic tokens, and HealthMetric component so the
 * page reads as a single uniform surface.
 *
 * Sections start collapsed by default and only mount their inner
 * components when expanded. Each inner component owns its own data
 * fetching and polling — keeping them unmounted until expansion means
 * loading the page does not trigger an API storm. Open/closed state is
 * persisted per-section in localStorage so an admin's preferred layout
 * sticks across visits.
 *
 * Auth flows through the existing useSystemAuth hook (localStorage
 * token), matching the rest of the /system/* admin pages.
 */
export default function SystemAdminPage() {
    const { token } = useSystemAuth();

    return (
        <Page>
            <PageHeader
                title="System"
                subtitle="Site configuration, WebSocket activity, and database administration."
            />
            <Stack gap="lg">
                <CollapsibleSection
                    id="config"
                    title="Configuration"
                    subtitle="Site URL used for canonical links, sitemaps, and SSR."
                    icon={<Settings size={20} aria-hidden="true" />}
                >
                    <SystemConfigSection token={token} />
                </CollapsibleSection>
                <CollapsibleSection
                    id="websockets"
                    title="WebSockets"
                    subtitle="Plugin subscription health and event throughput."
                    icon={<Radio size={20} aria-hidden="true" />}
                >
                    <WebSocketsSection token={token} />
                </CollapsibleSection>
                <CollapsibleSection
                    id="database"
                    title="Database"
                    subtitle="Health, schema migrations, and collection browser."
                    icon={<Database size={20} aria-hidden="true" />}
                >
                    <DatabaseSection token={token} />
                </CollapsibleSection>
            </Stack>
        </Page>
    );
}
