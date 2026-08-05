'use client';

import type { MouseEvent as ReactMouseEvent } from 'react';
import { Stack } from '../../../../../components/layout';
import { Card } from '../../../../../components/ui/Card';
import { ConsoleRow } from './ConsoleRow';
import { OverviewBar } from './OverviewBar';
import { ServerSection } from './ServerSection';
import { BlockchainSection } from './BlockchainSection';

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
 * — including the four that now live on their own tabs — from this one screen.
 * The console rows that remain (Server, Blockchain) each defer their fetch until
 * expanded, preserving the "no API storm on page load" guarantee.
 *
 * @param props - Tile activation handler supplied by the page shell.
 * @returns The overview console.
 */
export function OverviewTab({ onTileSelect }: IOverviewTabProps) {
    return (
        <Stack gap="sm">
            <OverviewBar onTileSelect={onTileSelect} />
            <Card padding="sm" noBackgroundImage>
                <ConsoleRow id="server" title="Server" status="idle">
                    <ServerSection />
                </ConsoleRow>
                <ConsoleRow id="blockchain" title="Blockchain" status="idle">
                    <BlockchainSection />
                </ConsoleRow>
            </Card>
        </Stack>
    );
}
