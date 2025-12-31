/**
 * @fileoverview Scheduler module type definitions.
 *
 * Defines interfaces for scheduler job status and health data returned
 * by the admin API endpoints.
 *
 * @module modules/scheduler/types
 */

/**
 * Scheduler job status information.
 *
 * Represents the current state and execution history of a scheduled job,
 * including schedule configuration, last run timing, and error details.
 */
export interface SchedulerJob {
    /** Unique job identifier (e.g., 'blockchain:sync', 'markets:refresh') */
    name: string;
    /** Cron expression defining the schedule (e.g., '0 0 * * *' for daily) */
    schedule: string;
    /** Whether the job is currently enabled */
    enabled: boolean;
    /** ISO timestamp of the last execution, null if never run */
    lastRun: string | null;
    /** ISO timestamp of the next scheduled execution, null if unknown */
    nextRun: string | null;
    /** Current execution status */
    status: 'running' | 'success' | 'failed' | 'never_run';
    /** Duration of last execution in seconds, null if never run */
    duration: number | null;
    /** Error message from last failed execution, null if last run succeeded */
    error: string | null;
}

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
