/**
 * @fileoverview Scheduler API client functions.
 *
 * Provides typed API functions for fetching scheduler status, health metrics,
 * and updating job configurations.
 *
 * @module modules/scheduler/api/client
 */

import type { SchedulerJob, SchedulerHealth, SchedulerJobUpdate } from '../types';

/**
 * Fetches the status of all scheduled jobs.
 *
 * Authorization rides the same-origin Better Auth session cookie;
 * the backend `requireAdmin` middleware resolves it per request.
 *
 * @returns Array of scheduler job status objects
 * @throws Error if the API request fails
 */
export async function getSchedulerStatus(): Promise<SchedulerJob[]> {
    const response = await fetch(
        `/api/admin/system/scheduler/status`
    );

    if (!response.ok) {
        throw new Error(`Failed to fetch scheduler status: ${response.status}`);
    }

    const data = await response.json();
    return data.jobs;
}

/**
 * Fetches scheduler health metrics.
 *
 * @returns Scheduler health metrics object
 * @throws Error if the API request fails
 */
export async function getSchedulerHealth(): Promise<SchedulerHealth> {
    const response = await fetch(
        `/api/admin/system/scheduler/health`
    );

    if (!response.ok) {
        throw new Error(`Failed to fetch scheduler health: ${response.status}`);
    }

    const data = await response.json();
    return data.health;
}

/**
 * Updates a scheduler job's configuration.
 *
 * @param jobName - Name of the job to update
 * @param updates - Configuration updates to apply
 * @throws Error if the API request fails or validation fails
 */
export async function updateSchedulerJob(
    jobName: string,
    updates: SchedulerJobUpdate
): Promise<void> {
    const response = await fetch(
        `/api/admin/system/scheduler/job/${jobName}`,
        {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        }
    );

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        throw new Error(errorData.message || `Server returned ${response.status}`);
    }
}

/**
 * Triggers an immediate, out-of-schedule run of a scheduler job.
 *
 * Lets an operator force a job to run now rather than waiting for its next cron
 * tick — the only way to exercise a low-frequency job (e.g. a 4-hourly snapshot)
 * that has not yet reached its first boundary. The job's enabled state is
 * irrelevant; the backend runs the handler once regardless and preserves
 * single-flight, so `started` is `false` (not an error) when a run was already in
 * progress.
 *
 * Authorization rides the same-origin Better Auth session cookie.
 *
 * @param jobName - Name of the job to run now.
 * @returns Whether a run was started (`false` if one was already in flight).
 * @throws Error if the API request fails.
 */
export async function runSchedulerJob(jobName: string): Promise<{ started: boolean }> {
    const response = await fetch(
        `/api/admin/system/scheduler/job/${jobName}/run`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }
    );

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || errorData.message || `Server returned ${response.status}`);
    }

    const data = await response.json();
    return { started: Boolean(data.started) };
}
