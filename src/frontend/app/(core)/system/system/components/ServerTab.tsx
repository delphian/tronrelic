'use client';

import { useCallback, useMemo, useState } from 'react';
import { Stack } from '../../../../../components/layout';
import { Card } from '../../../../../components/ui/Card';
import { RefreshIndicator } from './RefreshIndicator';
import { ServerSection } from './ServerSection';
import {
    foldRefresh,
    INITIAL_FRESHNESS,
    type IRefreshFreshness,
    type IRefreshReport,
    type IRefreshSource
} from './overview-refresh';
import styles from './ServerTab.module.scss';

/**
 * Server tab — droplet, containers, Redis, and the backend process.
 *
 * This used to be the Overview tab, where the Server console sat above the
 * Blockchain console and pushed it below the fold. Block ingestion now has its
 * own Pipeline tab, the page's default, so this tab holds the server readings
 * alone. The card keeps its `id` so `#server` stays a working deep link.
 *
 * The tab owns the freshness state the refresh readout renders, folding each
 * poll outcome into the previous freshness rather than replacing it, so a
 * failed cycle cannot erase the stamp that says how old the data is. The
 * folding callback is memoized with an empty dependency list, keeping the
 * referential stability the section's polling effect depends on.
 *
 * @returns The server console.
 */
export function ServerTab() {
    const [serverFreshness, setServerFreshness] = useState<IRefreshFreshness>(INITIAL_FRESHNESS);

    /**
     * Absorb one Server poll outcome without discarding its last good stamp.
     *
     * Folding inside the state updater is what makes the previous freshness
     * available at the moment the outcome lands — the section itself keeps no
     * history. The empty dependency list holds this identity stable for the
     * whole mount, which the section's polling effect requires.
     *
     * @param report - The outcome the Server console just stamped.
     */
    const noteServerRefresh = useCallback((report: IRefreshReport) => {
        setServerFreshness(previous => foldRefresh(previous, report));
    }, []);

    const refreshSources = useMemo<IRefreshSource[]>(() => [
        { label: 'Server', ...serverFreshness }
    ], [serverFreshness]);

    return (
        <Stack gap="lg">
            <RefreshIndicator sources={refreshSources} />

            <Card id="server" padding="sm" noBackgroundImage>
                <h3 className={styles.section_title}>Server</h3>
                <ServerSection onRefresh={noteServerRefresh} />
            </Card>
        </Stack>
    );
}
