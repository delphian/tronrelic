/**
 * @fileoverview Turns the /system/scheduler Jobs tab's search text and status
 * choice into the `jobFilter` predicate `SchedulerMonitor` takes.
 *
 * The page lists every job on the deployment, around fifty, and the monitor
 * already holds the whole list, so narrowing it happens in the browser with no
 * request. The monitor treats an unset filter as "every job" and shows the
 * deployment-wide success rate only then, so this returns `undefined` rather
 * than an always-true predicate when nothing narrows the list.
 */

import type { ISchedulerJobStatus } from '@/types';

/** The status choices on the Jobs tab's filter row. */
export type JobStatusFilter = 'all' | 'failed' | 'running' | 'disabled';

/** A predicate selecting the jobs the table lists. */
type JobPredicate = (job: ISchedulerJobStatus) => boolean;

/**
 * Whether a job is in the state the status choice names. Disabled reads the
 * switch rather than the status, because the status endpoint reports a
 * switched-off job as never run.
 */
function matchesStatus(job: ISchedulerJobStatus, status: JobStatusFilter): boolean {
    const matchers: Record<JobStatusFilter, boolean> = {
        all: true,
        failed: job.status === 'failed',
        running: job.status === 'running',
        disabled: !job.enabled
    };

    return matchers[status];
}

/**
 * Build the predicate for the Jobs tab's current filter.
 *
 * A name matches when it contains the search text anywhere, ignoring case, so
 * typing an owner's prefix such as `account-history` lists that owner's jobs
 * and typing `sync` finds every sync job whoever owns it.
 *
 * @param query - The search text as typed; surrounding spaces are ignored.
 * @param status - The status choice, `all` for no restriction.
 * @returns A predicate for `SchedulerMonitor`'s `jobFilter`, or `undefined`
 *          when the filter lets every job through, so the monitor keeps its
 *          unfiltered view with the success rate and full job names.
 */
export function buildJobFilter(query: string, status: JobStatusFilter): JobPredicate | undefined {
    const needle = query.trim().toLowerCase();
    let predicate: JobPredicate | undefined;

    if (needle !== '' || status !== 'all') {
        predicate = job => job.name.toLowerCase().includes(needle) && matchesStatus(job, status);
    }

    return predicate;
}
