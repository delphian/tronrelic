'use client';

import { Stack } from '../../../../../components/layout';
import { Card } from '../../../../../components/ui/Card';
import { ConsoleRow } from './ConsoleRow';
import { OverviewBar } from './OverviewBar';
import { SystemConfigSection } from './SystemConfigSection';
import { ServerSection } from './ServerSection';
import { BlockchainSection } from './BlockchainSection';
import { WebSocketsSection } from './WebSocketsSection';
import { MongoSection } from './MongoSection';
import { ClickHouseSection } from './ClickHouseSection';

/**
 * Overview tab — the subsystem mission-control console, unchanged from the prior
 * flat page.
 *
 * The OverviewBar polls lightly so admins see live state across all subsystems
 * even with every console row collapsed; each ConsoleRow defers its own fetch
 * until expanded, preserving the "no API storm on page load" guarantee. Extracted
 * into its own tab panel so the System page can host sibling concerns (Providers)
 * without disturbing this content.
 *
 * @returns The overview console.
 */
export function OverviewTab() {
    return (
        <Stack gap="sm">
            <OverviewBar />
            <Card padding="sm" noBackgroundImage>
                <ConsoleRow id="config" title="Configuration" status="idle">
                    <SystemConfigSection />
                </ConsoleRow>
                <ConsoleRow id="server" title="Server" status="idle">
                    <ServerSection />
                </ConsoleRow>
                <ConsoleRow id="blockchain" title="Blockchain" status="idle">
                    <BlockchainSection />
                </ConsoleRow>
                <ConsoleRow id="websockets" title="WebSockets" status="idle">
                    <WebSocketsSection />
                </ConsoleRow>
                <ConsoleRow id="mongo" title="MongoDB" status="idle">
                    <MongoSection />
                </ConsoleRow>
                <ConsoleRow id="clickhouse" title="ClickHouse" status="idle">
                    <ClickHouseSection />
                </ConsoleRow>
            </Card>
        </Stack>
    );
}
