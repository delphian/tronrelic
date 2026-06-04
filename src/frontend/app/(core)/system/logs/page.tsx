'use client';

import { Page, Stack } from '../../../../components/layout';
import { SystemLogsMonitor, LogSettings } from '../../../../modules/logs';

/**
 * System logs monitoring page.
 *
 * Displays paginated ERROR and WARN logs captured from the backend Pino logger.
 * Provides filtering by severity level, service/plugin, resolved status, and date range.
 * Includes live polling option for real-time log updates and bulk operations for
 * log management. Requires admin authentication.
 */
export default function SystemLogsPage() {
    return (
        <Page>
            <Stack gap="lg">
                <SystemLogsMonitor />
                <LogSettings />
            </Stack>
        </Page>
    );
}
