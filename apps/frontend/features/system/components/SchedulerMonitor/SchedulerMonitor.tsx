'use client';

import { useEffect, useState } from 'react';
import { config as runtimeConfig } from '@/lib/config';
import styles from './SchedulerMonitor.module.css';

interface SchedulerJob {
    name: string;
    schedule: string;
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
                            <div className={styles.metric_card__label}>Status</div>
                            <div className={styles.metric_card__value}>{health.enabled ? 'Enabled' : 'Disabled'}</div>
                        </div>

                        {health.uptime !== null && (
                            <div className={styles.metric_card}>
                                <div className={styles.metric_card__label}>Uptime</div>
                                <div className={styles.metric_card__value}>{formatUptime(health.uptime)}</div>
                            </div>
                        )}

                        <div className={styles.metric_card}>
                            <div className={styles.metric_card__label}>Success Rate</div>
                            <div className={styles.metric_card__value}>{health.successRate.toFixed(1)}%</div>
                        </div>
                    </div>
                )}
            </section>

            {/* Scheduled Jobs */}
            <section className={styles.section}>
                <h2 className={styles.section__title}>Scheduled Jobs</h2>
                <div className={styles.job_list}>
                    {jobs.map(job => (
                        <div
                            key={job.name}
                            className={`${styles.job_card} ${getJobCardClass(job.status)}`}
                        >
                            <div className={styles.job_header}>
                                <div className={styles.job_header__info}>
                                    <h3 className={styles.job_header__title}>{job.name}</h3>
                                    <p className={styles.job_header__schedule}>{job.schedule}</p>
                                </div>
                                <span className={`${styles.status_badge} ${getStatusBadgeClass(job.status)}`}>
                                    {job.status.replace('_', ' ')}
                                </span>
                            </div>

                            <div className={styles.job_meta}>
                                {job.lastRun && (
                                    <div>
                                        <span className={styles.job_meta__label}>Last run: </span>
                                        <span>{new Date(job.lastRun).toLocaleString()}</span>
                                    </div>
                                )}
                                {job.duration !== null && (
                                    <div>
                                        <span className={styles.job_meta__label}>Duration: </span>
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
                    ))}
                </div>
            </section>
        </div>
    );
}
