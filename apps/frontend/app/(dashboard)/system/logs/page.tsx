'use client';

import { SystemLogsMonitor, useSystemAuth } from '../../../../features/system';

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

    return <SystemLogsMonitor token={token} />;
}
