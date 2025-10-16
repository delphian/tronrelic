'use client';

import { useEffect, useState } from 'react';
import { config as runtimeConfig } from '../../../../lib/config';
import styles from './SchedulerMonitor.module.css';

interface SchedulerJob {
    name: string;
    schedule: string;
    enabled: boolean;
    lastRun: string | null;
    nextRun: string | null;
    status: 'running' | 'success' | 'failed' | 'never_run';
    duration: number | null;
    error: string | null;
}

interface SchedulerHealth {
    enabled: boolean;
    uptime: number | null;
    totalJobsExecuted: number;
    successRate: number;
    overdueJobs: string[];
}

interface Props {
    token: string;
}

/**
 * SchedulerMonitor Component
 *
 * Admin diagnostic tool for monitoring BullMQ scheduled job health and execution.
 * Displays scheduler status, job execution history, timing metrics, and error tracking.
 *
 * **Key Features:**
 * - Real-time job status tracking (success/failed/running/never_run)
 * - Scheduler health metrics (uptime, success rate)
 * - Job execution timing and duration tracking
 * - Error logging for failed jobs
 * - Auto-refresh every 10 seconds for near-real-time monitoring
 *
 * **Data Sources:**
 * - `/admin/system/scheduler/status` - Job execution history and current status
 * - `/admin/system/scheduler/health` - Scheduler health metrics and uptime
 *
 * **Security:**
 * Requires admin token authentication via X-Admin-Token header.
 *
 * @param {Props} props - Component props
 * @param {string} props.token - Admin authentication token for API requests
 *
 * @example
 * ```tsx
 * <SchedulerMonitor token={adminToken} />
 * ```
 */
export function SchedulerMonitor({ token }: Props) {
    const [jobs, setJobs] = useState<SchedulerJob[]>([]);
    const [health, setHealth] = useState<SchedulerHealth | null>(null);
    const [loading, setLoading] = useState(true);
    const [updatingJob, setUpdatingJob] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<{ jobName: string; type: 'success' | 'error'; message: string } | null>(null);

    /**
     * Fetches scheduler health and job status data from admin API endpoints.
     *
     * Uses Promise.all for parallel fetching to minimize latency.
     * Updates component state with fresh data or logs errors on failure.
     */
    const fetchData = async () => {
        try {
            const [jobsRes, healthRes] = await Promise.all([
                fetch(`${runtimeConfig.apiBaseUrl}/admin/system/scheduler/status`, {
                    headers: { 'X-Admin-Token': token }
                }),
                fetch(`${runtimeConfig.apiBaseUrl}/admin/system/scheduler/health`, {
                    headers: { 'X-Admin-Token': token }
                })
            ]);

            const [jobsData, healthData] = await Promise.all([jobsRes.json(), healthRes.json()]);
            setJobs(jobsData.jobs);
            setHealth(healthData.health);
        } catch (error) {
            console.error('Failed to fetch scheduler data:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 10000);
        return () => clearInterval(interval);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);

    /**
     * Formats uptime from seconds into a human-readable "Xh Ym" format.
     *
     * @param {number} seconds - Uptime duration in seconds
     * @returns {string} Formatted uptime string (e.g., "12h 34m")
     */
    const formatUptime = (seconds: number): string => {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return `${hours}h ${minutes}m`;
    };

    /**
     * Returns the appropriate CSS class variant based on job status.
     *
     * Maps job status to color-coded variants for visual feedback:
     * - success: Green border
     * - failed: Red border
     * - running: Blue border
     * - never_run: Gray border
     *
     * @param {string} status - Job execution status
     * @returns {string} CSS Module class name for status variant
     */
    const getJobCardClass = (status: string): string => {
        switch (status) {
            case 'success':
                return styles['job_card--success'];
            case 'failed':
                return styles['job_card--failed'];
            case 'running':
                return styles['job_card--running'];
            default:
                return styles['job_card--never_run'];
        }
    };

    /**
     * Returns the appropriate CSS class variant for status badges.
     *
     * @param {string} status - Job execution status
     * @returns {string} CSS Module class name for badge variant
     */
    const getStatusBadgeClass = (status: string): string => {
        switch (status) {
            case 'success':
                return styles['status_badge--success'];
            case 'failed':
                return styles['status_badge--failed'];
            case 'running':
                return styles['status_badge--running'];
            default:
                return styles['status_badge--never_run'];
        }
    };

    /**
     * Validates a cron expression format.
     *
     * Ensures the cron expression has exactly 5 space-separated fields:
     * minute, hour, day of month, month, day of week.
     *
     * @param {string} schedule - The cron expression to validate
     * @returns {boolean} True if valid, false otherwise
     */
    const isValidCronExpression = (schedule: string): boolean => {
        const trimmed = schedule.trim();
        const fields = trimmed.split(/\s+/);
        return fields.length === 5;
    };

    /**
     * Updates a scheduler job's configuration via the admin API.
     *
     * Sends a PATCH request to update either the schedule or enabled status.
     * Provides visual feedback via temporary success/error messages and
     * refreshes job data on successful update.
     *
     * @param {string} jobName - Name of the job to update
     * @param {Partial<Pick<SchedulerJob, 'schedule' | 'enabled'>>} updates - Fields to update
     */
    const updateJob = async (jobName: string, updates: Partial<Pick<SchedulerJob, 'schedule' | 'enabled'>>) => {
        setUpdatingJob(jobName);
        setFeedback(null);

        try {
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

            setFeedback({
                jobName,
                type: 'success',
                message: 'Job updated successfully'
            });

            // Refresh data after successful update
            await fetchData();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to update job';
            setFeedback({
                jobName,
                type: 'error',
                message
            });
        } finally {
            setUpdatingJob(null);

            // Clear feedback after 3 seconds
            setTimeout(() => {
                setFeedback(prev => prev?.jobName === jobName ? null : prev);
            }, 3000);
        }
    };

    /**
     * Handles toggling the enabled status of a scheduler job.
     *
     * @param {string} jobName - Name of the job to toggle
     * @param {boolean} currentEnabled - Current enabled state
     */
    const handleToggleEnabled = async (jobName: string, currentEnabled: boolean) => {
        await updateJob(jobName, { enabled: !currentEnabled });
    };

    /**
     * Handles updating a job's schedule after validation.
     *
     * Validates the cron expression before sending the update request.
     * Shows inline error message if validation fails.
     *
     * @param {string} jobName - Name of the job to update
     * @param {string} newSchedule - New cron schedule expression
     */
    const handleScheduleChange = async (jobName: string, newSchedule: string) => {
        if (!isValidCronExpression(newSchedule)) {
            setFeedback({
                jobName,
                type: 'error',
                message: 'Invalid cron expression. Must have 5 space-separated fields.'
            });
            setTimeout(() => {
                setFeedback(prev => prev?.jobName === jobName ? null : prev);
            }, 3000);
            return;
        }

        await updateJob(jobName, { schedule: newSchedule });
    };

    if (loading) {
        return <div className={styles.loading}>Loading scheduler monitoring data...</div>;
    }

    return (
        <div className={styles.container}>
            {/* Scheduler Health */}
            <section className={styles.section}>
                <h2 className={styles.section__title}>Scheduler Health</h2>
                {health && (
                    <div className={styles.health_grid}>
                        <div className={`${styles.metric_card} ${health.enabled ? styles['metric_card--enabled'] : styles['metric_card--disabled']}`}>
                            <div className={styles['metric_card__label']}>Status</div>
                            <div className={styles['metric_card__value']}>{health.enabled ? 'Enabled' : 'Disabled'}</div>
                        </div>

                        {health.uptime !== null && (
                            <div className={styles.metric_card}>
                                <div className={styles['metric_card__label']}>Uptime</div>
                                <div className={styles['metric_card__value']}>{formatUptime(health.uptime)}</div>
                            </div>
                        )}

                        <div className={styles.metric_card}>
                            <div className={styles['metric_card__label']}>Success Rate</div>
                            <div className={styles['metric_card__value']}>{health.successRate.toFixed(1)}%</div>
                        </div>
                    </div>
                )}
            </section>

            {/* Scheduled Jobs */}
            <section className={styles.section}>
                <h2 className={styles.section__title}>Scheduled Jobs</h2>
                <div className={styles.job_list}>
                    {jobs.map(job => {
                        const isUpdating = updatingJob === job.name;
                        const jobFeedback = feedback?.jobName === job.name ? feedback : null;

                        return (
                            <div
                                key={job.name}
                                className={`${styles.job_card} ${getJobCardClass(job.status)} ${job.enabled ? styles['job_card--enabled'] : styles['job_card--disabled']}`}
                            >
                                <div className={styles.job_header}>
                                    <div className={styles['job_header__info']}>
                                        <h3 className={styles['job_header__title']}>{job.name}</h3>
                                    </div>
                                    <span className={`${styles.status_badge} ${getStatusBadgeClass(job.status)}`}>
                                        {job.status.replace('_', ' ')}
                                    </span>
                                </div>

                                {/* Admin Controls */}
                                <div className={styles.controls}>
                                    <div className={styles.control_group}>
                                        <label className={styles.control_label}>
                                            <input
                                                type="checkbox"
                                                checked={job.enabled}
                                                onChange={() => handleToggleEnabled(job.name, job.enabled)}
                                                disabled={isUpdating}
                                                className={styles.checkbox}
                                            />
                                            <span className={styles.checkbox_label}>
                                                {job.enabled ? 'Enabled' : 'Disabled'}
                                            </span>
                                        </label>
                                    </div>

                                    <div className={styles.control_group}>
                                        <label className={styles.control_label}>
                                            <span className={styles.input_label}>Schedule:</span>
                                            <input
                                                type="text"
                                                defaultValue={job.schedule}
                                                onBlur={(e) => {
                                                    const newValue = e.target.value.trim();
                                                    if (newValue !== job.schedule) {
                                                        handleScheduleChange(job.name, newValue);
                                                    }
                                                }}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        e.currentTarget.blur();
                                                    }
                                                }}
                                                disabled={isUpdating}
                                                className={styles.schedule_input}
                                                placeholder="*/5 * * * *"
                                            />
                                        </label>
                                    </div>
                                </div>

                                {/* Loading/Feedback */}
                                {isUpdating && (
                                    <div className={styles.feedback_loading}>
                                        Updating...
                                    </div>
                                )}

                                {jobFeedback && !isUpdating && (
                                    <div className={jobFeedback.type === 'success' ? styles.feedback_success : styles.feedback_error}>
                                        {jobFeedback.message}
                                    </div>
                                )}

                                <div className={styles.job_meta}>
                                    {job.lastRun && (
                                        <div>
                                            <span className={styles['job_meta__label']}>Last run: </span>
                                            <span>{new Date(job.lastRun).toLocaleString()}</span>
                                        </div>
                                    )}
                                    {job.duration !== null && (
                                        <div>
                                            <span className={styles['job_meta__label']}>Duration: </span>
                                            <span>{job.duration.toFixed(2)}s</span>
                                        </div>
                                    )}
                                </div>

                                {job.error && (
                                    <div className={styles.error_box}>
                                        {job.error}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </section>
        </div>
    );
}
