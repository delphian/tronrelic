'use client';

import { Page, Stack } from '../../../../components/layout';
import { Card } from '../../../../components/ui/Card';
import { ConsoleRow } from './components/ConsoleRow';
import { OverviewBar } from './components/OverviewBar';
import { SystemConfigSection } from './components/SystemConfigSection';
import { ServerSection } from './components/ServerSection';
import { BlockchainSection } from './components/BlockchainSection';
import { TransactionToolSection } from './components/TransactionToolSection';
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
    return (
        <Page>
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
                    <ConsoleRow id="transaction-tool" title="Transaction Tool" status="idle">
                        <TransactionToolSection />
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
        </Page>
    );
}
