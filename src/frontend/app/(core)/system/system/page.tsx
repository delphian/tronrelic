'use client';

import { Page, Stack } from '../../../../components/layout';
import { Card } from '../../../../components/ui/Card';
import { useSystemAuth } from '../../../../features/system';
import { ConsoleRow } from './components/ConsoleRow';
import { OverviewBar } from './components/OverviewBar';
import { SystemConfigSection } from './components/SystemConfigSection';
import { ServerSection } from './components/ServerSection';
import { BlockchainSection } from './components/BlockchainSection';
import { WebSocketsSection } from './components/WebSocketsSection';
import { MongoSection } from './components/MongoSection';
import { ClickHouseSection } from './components/ClickHouseSection';

/**
 * Consolidated System admin page — mission-control redesign.
 *
 * The OverviewBar at the top runs its own light polling so admins see
 * live state across all five subsystems even with every console row
 * collapsed. Below the bar, ConsoleRow sections collapse to a single
 * thin line apiece (status dot + caps title + monospace summary) and
 * defer their own data fetching until expanded — preserving the
 * "no API storm on page load" guarantee from the previous design.
 */
export default function SystemAdminPage() {
    const { token } = useSystemAuth();

    return (
        <Page>
            <Stack gap="sm">
                <OverviewBar token={token} />
                <Card padding="sm" noBackgroundImage>
                    <ConsoleRow id="config" title="Configuration" status="idle">
                        <SystemConfigSection token={token} />
                    </ConsoleRow>
                    <ConsoleRow id="server" title="Server" status="idle">
                        <ServerSection token={token} />
                    </ConsoleRow>
                    <ConsoleRow id="blockchain" title="Blockchain" status="idle">
                        <BlockchainSection token={token} />
                    </ConsoleRow>
                    <ConsoleRow id="websockets" title="WebSockets" status="idle">
                        <WebSocketsSection token={token} />
                    </ConsoleRow>
                    <ConsoleRow id="mongo" title="MongoDB" status="idle">
                        <MongoSection token={token} />
                    </ConsoleRow>
                    <ConsoleRow id="clickhouse" title="ClickHouse" status="idle">
                        <ClickHouseSection token={token} />
                    </ConsoleRow>
                </Card>
            </Stack>
        </Page>
    );
}
