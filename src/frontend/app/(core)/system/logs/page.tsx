'use client';

import { Page, Section } from '../../../../components/layout';
import { SystemLogsMonitor, LogSettings } from '../../../../modules/logs';
import styles from './page.module.scss';

/**
 * System logs page: every saved log entry across the deployment, with the
 * backend's recording level beneath it. Admin-gated by the /system layout.
 *
 * The viewer loads its data after mount, so the page itself has nothing to
 * fetch on the server. Laid out like the curation admin page: a visually
 * hidden heading, then one Section so the viewer and the settings row are
 * spaced by a section gap rather than the much larger page gap.
 *
 * @returns The logs page.
 */
export default function SystemLogsPage() {
    return (
        <Page>
            {/* The System layout supplies navigation but no heading, so this
                names the page for screen readers without repeating the menu
                entry on screen. */}
            <h1 className={styles.sr_only}>System logs</h1>
            <Section gap="md">
                <SystemLogsMonitor />
                <LogSettings />
            </Section>
        </Page>
    );
}
