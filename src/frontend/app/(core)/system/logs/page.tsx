'use client';

import { useSystemAuth } from '../../../../features/system';
import { Page, PageHeader, Stack } from '../../../../components/layout';
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
    const { token } = useSystemAuth();

    return (
        <Page>
            <PageHeader
                title="System Logs"
                subtitle="Monitor and manage backend log entries"
            />
            <Stack gap="lg">
                <SystemLogsMonitor token={token} />
                <LogSettings token={token} />
            </Stack>
        </Page>
    );
}
