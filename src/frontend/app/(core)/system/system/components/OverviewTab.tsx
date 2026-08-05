'use client';

import type { MouseEvent as ReactMouseEvent } from 'react';
import { Stack } from '../../../../../components/layout';
import { Card } from '../../../../../components/ui/Card';
import { OverviewBar } from './OverviewBar';
import { ServerSection } from './ServerSection';
import { BlockchainSection } from './BlockchainSection';
import styles from './OverviewTab.module.scss';

/**
 * Props for the overview console.
 */
interface IOverviewTabProps {
    /**
     * Activate the tab that now owns a telemetry tile's subsystem.
     *
     * Configuration, WebSockets, MongoDB, and ClickHouse each moved to their own
     * tab, so the tiles for those subsystems can no longer scroll to an in-page
     * console row. The page shell supplies this so a tile click switches tabs
     * instead of following a `#hash` that resolves to nothing.
     */
    onTileSelect: (tileId: string, event: ReactMouseEvent<HTMLAnchorElement>) => void;
}

/**
 * Overview tab — the subsystem mission-control console.
 *
 * The OverviewBar polls lightly so admins see live state across every subsystem
 * — including the four that live on their own tabs — from this one screen.
 *
 * Server and Blockchain each occupy their own card and render expanded. They
 * were previously collapsible rows sharing one outer card, which cost a click to
 * read either one; with only two sections left on this tab there is little left
 * to hide. Each card keeps the `id` its row carried (`server`, `blockchain`)
 * because the telemetry tiles above are anchors that scroll to exactly those ids.
 *
 * Both sections now mount with the tab rather than on expand, so both poll
 * whenever Overview is open. That is the load the split rate-limit buckets were
 * sized against — blockchain 26/min and health 28/min against a 60/min ceiling
 * each — so always-on polling stays well inside budget.
 *
 * @param props - Tile activation handler supplied by the page shell.
 * @returns The overview console.
 */
export function OverviewTab({ onTileSelect }: IOverviewTabProps) {
    return (
        <Stack gap="sm">
            <OverviewBar onTileSelect={onTileSelect} />

            <Card id="server" padding="sm" noBackgroundImage>
                <h3 className={styles.section_title}>Server</h3>
                <ServerSection />
            </Card>

            <Card id="blockchain" padding="sm" noBackgroundImage>
                <h3 className={styles.section_title}>Blockchain</h3>
                <BlockchainSection />
            </Card>
        </Stack>
    );
}
