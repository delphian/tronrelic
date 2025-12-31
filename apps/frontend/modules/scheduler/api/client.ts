/**
 * @fileoverview Scheduler API client functions.
 *
 * Provides typed API functions for fetching scheduler status, health metrics,
 * and updating job configurations.
 *
 * @module modules/scheduler/api/client
 */

import { config as runtimeConfig } from '../../../lib/config';
import type { SchedulerJob, SchedulerHealth, SchedulerJobUpdate } from '../types';

/**
 * Fetches the status of all scheduled jobs.
 *
 * @param token - Admin authentication token
 * @returns Array of scheduler job status objects
 * @throws Error if the API request fails
 */
export async function getSchedulerStatus(token: string): Promise<SchedulerJob[]> {
    const response = await fetch(
        `${runtimeConfig.apiBaseUrl}/admin/system/scheduler/status`,
        {
            headers: { 'X-Admin-Token': token }
        }
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
 * @param token - Admin authentication token
 * @returns Scheduler health metrics object
 * @throws Error if the API request fails
 */
export async function getSchedulerHealth(token: string): Promise<SchedulerHealth> {
    const response = await fetch(
        `${runtimeConfig.apiBaseUrl}/admin/system/scheduler/health`,
        {
            headers: { 'X-Admin-Token': token }
        }
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
 * @param token - Admin authentication token
 * @param jobName - Name of the job to update
 * @param updates - Configuration updates to apply
 * @throws Error if the API request fails or validation fails
 */
export async function updateSchedulerJob(
    token: string,
    jobName: string,
    updates: SchedulerJobUpdate
): Promise<void> {
    const response = await fetch(
        `${runtimeConfig.apiBaseUrl}/admin/system/scheduler/job/${jobName}`,
        {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'X-Admin-Token': token
            },
            body: JSON.stringify(updates)
        }
    );

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        throw new Error(errorData.message || `Server returned ${response.status}`);
    }
}
