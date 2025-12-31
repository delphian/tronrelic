'use client';

import { useSystemAuth } from '../../../../features/system';
import { SchedulerMonitor } from '../../../../modules/scheduler';

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
