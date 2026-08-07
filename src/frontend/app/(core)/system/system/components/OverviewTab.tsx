'use client';

import { useCallback, useMemo, useState } from 'react';
import { Stack } from '../../../../../components/layout';
import { Card } from '../../../../../components/ui/Card';
import { RefreshIndicator } from './RefreshIndicator';
import { ServerSection } from './ServerSection';
import { BlockchainSection } from './BlockchainSection';
import {
    foldRefresh,
    INITIAL_FRESHNESS,
    type IRefreshFreshness,
    type IRefreshReport,
    type IRefreshSource
} from './overview-refresh';
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
 * their common parent. Each section's outcome is folded into the previous
 * freshness rather than replacing it, so a failed cycle cannot erase the stamp
 * that says how old the data is. The folding callbacks are memoized with empty
 * dependency lists, keeping the referential stability the sections' polling
 * effects depend on.
 *
 * @returns The overview console.
 */
export function OverviewTab() {
    const [serverFreshness, setServerFreshness] = useState<IRefreshFreshness>(INITIAL_FRESHNESS);
    const [blockchainFreshness, setBlockchainFreshness] = useState<IRefreshFreshness>(
        INITIAL_FRESHNESS
    );

    /**
     * Absorb one Server poll outcome without discarding its last good stamp.
     *
     * Folding inside the state updater is what makes the previous freshness
     * available at the moment the outcome lands — the section itself keeps no
     * history. The empty dependency list holds this identity stable for the whole
     * mount, which the section's polling effect requires.
     *
     * @param report - The outcome the Server console just stamped.
     */
    const noteServerRefresh = useCallback((report: IRefreshReport) => {
        setServerFreshness(previous => foldRefresh(previous, report));
    }, []);

    /**
     * Absorb one Blockchain poll outcome without discarding its last good stamp.
     *
     * Mirrors `noteServerRefresh` so both consoles are folded by one rule; see it
     * for why the fold happens here and why the identity must stay stable.
     *
     * @param report - The outcome the Blockchain console just stamped.
     */
    const noteBlockchainRefresh = useCallback((report: IRefreshReport) => {
        setBlockchainFreshness(previous => foldRefresh(previous, report));
    }, []);

    const refreshSources = useMemo<IRefreshSource[]>(() => [
        { label: 'Server', ...serverFreshness },
        { label: 'Blockchain', ...blockchainFreshness }
    ], [serverFreshness, blockchainFreshness]);

    return (
        <Stack gap="lg">
            <RefreshIndicator sources={refreshSources} />

            <Card id="server" padding="sm" noBackgroundImage>
                <h3 className={styles.section_title}>Server</h3>
                <ServerSection onRefresh={noteServerRefresh} />
            </Card>

            <Card id="blockchain" padding="sm" noBackgroundImage>
                <h3 className={styles.section_title}>Blockchain</h3>
                <BlockchainSection onRefresh={noteBlockchainRefresh} />
            </Card>
        </Stack>
    );
}
