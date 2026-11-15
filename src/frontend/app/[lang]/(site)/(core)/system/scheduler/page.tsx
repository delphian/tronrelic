'use client';

/**
 * @fileoverview /system/scheduler: every scheduled job on the deployment.
 *
 * The page owns the single `<Page>` and the `<h1>`. `SchedulerMonitor` renders
 * only its content, because the same component is embedded as a tab on module
 * admin pages that already have a page wrapper of their own.
 */

import { Page, PageHeader } from '../../../../../../components/layout';
import { SchedulerMonitor } from '../../../../../../modules/scheduler';

/**
 * Scheduler monitoring page.
 *
 * Displays scheduled job status, execution history, and runtime configuration controls.
 * Provides detailed visibility into cron jobs for blockchain sync, market refresh,
 * cache cleanup, and alert dispatch. Allows runtime enable/disable of individual jobs
 * without backend restarts. Requires admin authentication.
 *
 * @returns The page with its header and the full job list.
 */
export default function SchedulerMonitorPage() {
    return (
        <Page>
            <PageHeader title="Scheduler" subtitle="Every scheduled job, its cron schedule, and its last run." />
            <SchedulerMonitor />
        </Page>
    );
}
