'use client';

import { SchedulerMonitor, useSystemAuth } from '../../../../features/system';

/**
 * Scheduler monitoring page.
 *
 * Displays scheduled job status, execution history, and runtime configuration controls.
 * Provides detailed visibility into cron jobs for blockchain sync, market refresh,
 * cache cleanup, and alert dispatch. Allows runtime enable/disable of individual jobs
 * without backend restarts. Requires admin authentication.
 */
export default function SchedulerMonitorPage() {
    const { token } = useSystemAuth();

    return <SchedulerMonitor token={token} />;
}
