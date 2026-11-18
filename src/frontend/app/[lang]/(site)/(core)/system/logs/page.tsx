'use client';

/**
 * @fileoverview /system/logs: every saved log entry across the deployment,
 * with the backend's recording level beneath it. Admin-gated by the /system
 * layout.
 *
 * The page wraps one shared monitor, as /system/scheduler and /system/plugins
 * do, and like them it opens on a visible compact header so the operator can
 * see which page they are on. The viewer loads its data after mount, so the
 * page itself has nothing to fetch on the server.
 */

import { AdminPage } from '../../../../../../components/layout';
import { SystemLogsMonitor, LogSettings } from '../../../../../../modules/logs';

/**
 * System logs page.
 *
 * `AdminPage` supplies the page's `h1` and places the viewer and the settings
 * row one stack gap apart, the spacing the page used before it had a visible
 * header. The subtitle leaves out the recording level, whose row names
 * itself, so it stays one line on a phone.
 *
 * @returns The logs page.
 */
export default function SystemLogsPage() {
    return (
        <AdminPage title="Logs" subtitle="Saved entries from every service, newest first.">
            <SystemLogsMonitor />
            <LogSettings />
        </AdminPage>
    );
}
