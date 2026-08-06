'use client';

import { useMemo, useState } from 'react';
import { Stack } from '../../../../../components/layout';
import { Card } from '../../../../../components/ui/Card';
import { RefreshIndicator } from './RefreshIndicator';
import { ServerSection } from './ServerSection';
import { BlockchainSection } from './BlockchainSection';
import type { IRefreshReport, IRefreshSource } from './overview-refresh';
import styles from './OverviewTab.module.scss';

/**
 * Overview tab — the subsystem mission-control console.
 *
 * Server and Blockchain each occupy their own card and render expanded. They
 * were previously collapsible rows sharing one outer card, which cost a click to
 * read either one; with only two sections left on this tab there is little left
 * to hide. Each card keeps its `id` so `#server` and `#blockchain` stay working
 * deep links.
 *
 * A telemetry strip used to sit above these cards, mirroring every subsystem's
 * status — including the four that live on their own tabs — as a row of tiles.
 * It was removed: the two subsystems still on this tab publish the same state
 * below in full detail, so the tiles duplicated what the reader could already
 * see. Only the refresh readout survives, since nothing else reports when the
 * screen last updated.
 *
 * Both sections mount with the tab rather than on expand, so both poll whenever
 * Overview is open. That is the load the split rate-limit buckets were sized
 * against — blockchain 26/min and health 34/min against a 60/min ceiling each —
 * so always-on polling stays well inside budget, with more headroom now that the
 * strip's seven probes are gone.
 *
 * This tab also owns the freshness state the readout renders. Each section polls
 * on its own and neither can see the other, so the only place that knows how
 * current the whole screen is — and whether a console has stopped answering — is
 * their common parent. The two `useState` setters are passed down directly
 * because React guarantees their identity is stable, which the sections' polling
 * effects depend on.
 *
 * @returns The overview console.
 */
export function OverviewTab() {
    const [serverRefresh, setServerRefresh] = useState<IRefreshReport | null>(null);
    const [blockchainRefresh, setBlockchainRefresh] = useState<IRefreshReport | null>(null);

    const refreshSources = useMemo<IRefreshSource[]>(() => [
        { label: 'Server', report: serverRefresh },
        { label: 'Blockchain', report: blockchainRefresh }
    ], [serverRefresh, blockchainRefresh]);

    return (
        <Stack gap="sm">
            <RefreshIndicator sources={refreshSources} />

            <Card id="server" padding="sm" noBackgroundImage>
                <h3 className={styles.section_title}>Server</h3>
                <ServerSection onRefresh={setServerRefresh} />
            </Card>

            <Card id="blockchain" padding="sm" noBackgroundImage>
                <h3 className={styles.section_title}>Blockchain</h3>
                <BlockchainSection onRefresh={setBlockchainRefresh} />
            </Card>
        </Stack>
    );
}
