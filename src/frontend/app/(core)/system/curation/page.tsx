'use client';

/**
 * @fileoverview /system/curation — the central curation queue admin surface.
 *
 * Every effect held for human review across the platform — drafted tweets,
 * broadcast messages, generated images, any future reviewable content — surfaces
 * in one inbox here, rather than each plugin hosting its own approval UI.
 * Admin-gated by the /system layout; like the other system pages it is a client
 * component that fetches over the cookie-authenticated admin API. The pending
 * count in the header stays live off the `curation:changed` WebSocket refetch
 * signal — the data itself always comes from the gated REST feed.
 */

import { useEffect, useState, useCallback } from 'react';
import { Page, PageHeader } from '../../../../components/layout';
import { Badge } from '../../../../components/ui/Badge';
import { getSocket } from '../../../../lib/socketClient';
import { getCurationsCount } from '../../../../modules/curation';
import { CurationQueue } from './CurationQueue';
import styles from './page.module.scss';

/**
 * Central curation queue page.
 *
 * @returns The page.
 */
export default function CurationAdminPage() {
    const [pending, setPending] = useState(0);

    const refreshPending = useCallback(async () => {
        try {
            setPending(await getCurationsCount());
        } catch {
            /* secondary data — leave the count as-is on failure */
        }
    }, []);

    useEffect(() => {
        void refreshPending();
    }, [refreshPending]);

    // Keep the header badge live regardless of which view is open.
    useEffect(() => {
        const socket = getSocket();
        const onCurations = () => { void refreshPending(); };
        socket.on('curation:changed', onCurations);
        return () => { socket.off('curation:changed', onCurations); };
    }, [refreshPending]);

    return (
        <Page>
            <PageHeader
                title="Curation"
                subtitle="Review every effect held for human approval across the platform — approve, edit, or reject in one inbox."
            />
            <div className={styles.container}>
                {pending > 0 && (
                    <div className={styles.summary}>
                        <Badge tone="warning">{pending}</Badge>
                        <span className="text-muted">awaiting review</span>
                    </div>
                )}
                <CurationQueue onChanged={refreshPending} />
            </div>
        </Page>
    );
}
