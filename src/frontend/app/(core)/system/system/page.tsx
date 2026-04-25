'use client';

import { Settings, Radio, Database, Server, Blocks } from 'lucide-react';
import { Page, Stack } from '../../../../components/layout';
import { useSystemAuth } from '../../../../features/system';
import { CollapsibleSection } from './components/CollapsibleSection';
import { SystemConfigSection } from './components/SystemConfigSection';
import { ServerSection } from './components/ServerSection';
import { BlockchainSection } from './components/BlockchainSection';
import { WebSocketsSection } from './components/WebSocketsSection';
import { DatabaseSection } from './components/DatabaseSection';

/**
 * Consolidated System admin page.
 *
 * First entry in the admin nav. Replaces the separate Config, Blockchain,
 * WebSockets, and Database pages with collapsible sections that share the
 * same layout primitives, semantic tokens, and HealthMetric component so
 * the page reads as a single uniform surface.
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
                    id="server"
                    title="Server"
                    subtitle="Redis cache liveness and Node.js process metrics."
                    icon={<Server size={20} aria-hidden="true" />}
                >
                    <ServerSection token={token} />
                </CollapsibleSection>
                <CollapsibleSection
                    id="blockchain"
                    title="Blockchain"
                    subtitle="Sync status, pipeline timings, and observer performance."
                    icon={<Blocks size={20} aria-hidden="true" />}
                >
                    <BlockchainSection token={token} />
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
