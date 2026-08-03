/**
 * @fileoverview Scheduler module type definitions.
 *
 * Defines interfaces for scheduler job status and health data returned
 * by the admin API endpoints.
 *
 * @module modules/scheduler/types
 */

import type { ISchedulerJobStatus } from '@/types';

/**
 * Scheduler job status information.
 *
 * Aliases the published {@link ISchedulerJobStatus} rather than restating
 * its fields. The same shape reaches plugins through the filter predicate
 * on `context.system.SchedulerMonitor`, so two hand-maintained copies of
 * one contract is precisely the drift this module already suffered once.
 * The local name is kept so existing module consumers read unchanged.
 */
export type SchedulerJob = ISchedulerJobStatus;

/**
 * Scheduler health metrics.
 *
 * Provides overall scheduler status including uptime and execution statistics.
 */
export interface SchedulerHealth {
    /** Whether the scheduler is enabled */
    enabled: boolean;
    /** Scheduler uptime in seconds, null if not running */
    uptime: number | null;
    /** Total number of job executions since startup */
    totalJobsExecuted?: number;
    /** Percentage of successful job executions */
    successRate?: number;
    /** List of job names that are overdue for execution */
    overdueJobs?: string[];
}

/**
 * Job update request payload.
 *
 * Used when updating a job's configuration via the admin API.
 */
export interface SchedulerJobUpdate {
    /** New cron schedule expression */
    schedule?: string;
    /** New enabled state */
    enabled?: boolean;
}
