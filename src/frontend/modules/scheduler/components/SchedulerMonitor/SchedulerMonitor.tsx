'use client';

/**
 * @fileoverview SchedulerMonitor component for admin job monitoring.
 *
 * Displays scheduler jobs in a compact table format with inline controls,
 * expandable details, and aggregate statistics. Matches the plugins admin
 * page pattern for consistency.
 *
 * This is an admin-only component that requires authentication, so client-side
 * data fetching with loading states is appropriate here (not subject to SSR
 * pattern for public content).
 *
 * @module modules/scheduler/components/SchedulerMonitor
 */

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, AlertCircle } from 'lucide-react';
import { Page, Stack } from '../../../../components/layout';
import { Badge } from '../../../../components/ui/Badge';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../components/ui/Table';
import { ClientTime } from '../../../../components/ui/ClientTime';
import { getSchedulerStatus, getSchedulerHealth, updateSchedulerJob } from '../../api';
import type { SchedulerJob, SchedulerHealth } from '../../types';
import styles from './SchedulerMonitor.module.scss';

interface Props {
    token: string;
    /** Optional filter to show only specific jobs. Can be job names or a filter function. */
    jobFilter?: string[] | ((job: SchedulerJob) => boolean);
    /** Optional title override for the stats bar */
    title?: string;
    /** Hide the stats bar (useful when embedding in other pages) */
    hideStats?: boolean;
}

/**
 * Toggle switch component for boolean state changes.
 *
 * Displays a sliding toggle control with loading state feedback.
 * Used for enable/disable job actions without confirmation dialogs.
 */
function Toggle({ enabled, onChange, disabled, loading }: {
    enabled: boolean;
    onChange: () => void;
    disabled?: boolean;
    loading?: boolean;
}) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={onChange}
            disabled={disabled || loading}
            className={`${styles.toggle} ${enabled ? styles.toggle_on : styles.toggle_off} ${loading ? styles.toggle_loading : ''}`}
        >
            <span className={styles.toggle_thumb} />
        </button>
    );
}

/**
 * Job row component for the scheduler table.
 *
 * Displays job metadata in a compact row with expandable details section.
 * Provides inline toggle for enable/disable and editable schedule field.
 */
function JobRow({ job, onToggleEnabled, onScheduleChange, isLoading, loadingJobName, feedback }: {
    job: SchedulerJob;
    onToggleEnabled: (jobName: string, enabled: boolean) => void;
    onScheduleChange: (jobName: string, schedule: string) => void;
    isLoading: boolean;
    loadingJobName: string | null;
    feedback: { jobName: string; type: 'success' | 'error'; message: string } | null;
}) {
    const [expanded, setExpanded] = useState(false);
    const isThisLoading = loadingJobName === job.name;
    const jobFeedback = feedback?.jobName === job.name ? feedback : null;

    const getStatusTone = (status: string): 'success' | 'danger' | 'warning' | 'neutral' => {
        switch (status) {
            case 'success': return 'success';
            case 'failed': return 'danger';
            case 'running': return 'warning';
            default: return 'neutral';
        }
    };

    return (
        <>
            <Tr hasError={job.status === 'failed'}>
                <Td className={styles.cell_expand}>
                    <button
                        type="button"
                        onClick={() => setExpanded(!expanded)}
                        className={styles.expand_btn}
                        aria-expanded={expanded}
                        aria-label={expanded ? 'Collapse details' : 'Expand details'}
                    >
                        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                </Td>
                <Td>
                    <div className={styles.job_name}>
                        {job.name}
                        {job.status === 'failed' && (
                            <AlertCircle size={14} className={styles.error_icon} />
                        )}
                    </div>
                </Td>
                <Td className={styles.cell_schedule}>
                    <input
                        type="text"
                        defaultValue={job.schedule}
                        onBlur={(e) => {
                            const newValue = e.target.value.trim();
                            if (newValue !== job.schedule) {
                                onScheduleChange(job.name, newValue);
                            }
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.currentTarget.blur();
                            }
                        }}
                        disabled={isLoading}
                        className={styles.schedule_input}
                        placeholder="0 * * * *"
                    />
                </Td>
                <Td className={styles.cell_status}>
                    <Badge tone={getStatusTone(job.status)}>
                        {job.status.replace('_', ' ')}
                    </Badge>
                </Td>
                <Td muted className={styles.cell_last_run}>
                    {job.lastRun ? (
                        <ClientTime date={job.lastRun} format="relative" />
                    ) : (
                        <span className={styles.never_run}>Never</span>
                    )}
                </Td>
                <Td className={styles.cell_enabled}>
                    <Toggle
                        enabled={job.enabled}
                        onChange={() => onToggleEnabled(job.name, !job.enabled)}
                        disabled={isLoading}
                        loading={isThisLoading}
                    />
                </Td>
            </Tr>
            {expanded && (
                <Tr isExpanded>
                    <Td colSpan={6}>
                        <div className={styles.details_content}>
                            {jobFeedback && (
                                <div className={jobFeedback.type === 'success' ? styles.alert_success : styles.alert_error}>
                                    {jobFeedback.type === 'error' && <AlertCircle size={14} />}
                                    {jobFeedback.message}
                                </div>
                            )}

                            <div className={styles.details_grid}>
                                {job.duration !== null && (
                                    <div className={styles.detail_item}>
                                        <span className={styles.detail_label}>Duration</span>
                                        <span className={styles.detail_value}>{job.duration.toFixed(2)}s</span>
                                    </div>
                                )}
                                {job.nextRun && (
                                    <div className={styles.detail_item}>
                                        <span className={styles.detail_label}>Next Run</span>
                                        <span className={styles.detail_value}>
                                            <ClientTime date={job.nextRun} format="datetime" />
                                        </span>
                                    </div>
                                )}
                                {job.lastRun && (
                                    <div className={styles.detail_item}>
                                        <span className={styles.detail_label}>Last Run</span>
                                        <span className={styles.detail_value}>
                                            <ClientTime date={job.lastRun} format="datetime" />
                                        </span>
                                    </div>
                                )}
                            </div>

                            {job.error && (
                                <div className={styles.error_block}>
                                    <div className={styles.error_header}>
                                        <AlertCircle size={14} />
                                        <span>Error</span>
                                    </div>
                                    <p className={styles.error_message}>{job.error}</p>
                                </div>
                            )}
                        </div>
                    </Td>
                </Tr>
            )}
        </>
    );
}

/**
 * SchedulerMonitor Component
 *
 * Admin diagnostic tool for monitoring BullMQ scheduled job health and execution.
 * Displays jobs in a compact table format with inline controls and expandable details.
 *
 * **Key Features:**
 * - Real-time job status tracking (success/failed/running/never_run)
 * - Aggregate statistics bar (total, enabled, running, failed counts)
 * - Inline toggle switches for enable/disable
 * - Editable cron schedule fields
 * - Expandable rows for detailed job information
 * - Auto-refresh every 10 seconds for near-real-time monitoring
 *
 * @param props - Component props
 * @param props.token - Admin authentication token for API requests
 * @param props.jobFilter - Optional filter to show only specific jobs
 * @param props.title - Optional title for the stats bar
 * @param props.hideStats - Hide the stats bar when embedding
 */
export function SchedulerMonitor({ token, jobFilter, title = 'Scheduled Jobs', hideStats = false }: Props) {
    const [jobs, setJobs] = useState<SchedulerJob[]>([]);
    const [health, setHealth] = useState<SchedulerHealth | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingJobName, setLoadingJobName] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<{ jobName: string; type: 'success' | 'error'; message: string } | null>(null);

    /**
     * Fetches scheduler health and job status data from admin API endpoints.
     */
    const fetchData = async () => {
        try {
            const [jobsData, healthData] = await Promise.all([
                getSchedulerStatus(token),
                getSchedulerHealth(token)
            ]);
            setJobs(jobsData);
            setHealth(healthData);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch scheduler data');
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
     * Validates a cron expression format.
     */
    const isValidCronExpression = (schedule: string): boolean => {
        const trimmed = schedule.trim();
        const fields = trimmed.split(/\s+/);
        return fields.length === 5;
    };

    /**
     * Updates a scheduler job's configuration via the admin API.
     */
    const handleUpdateJob = async (jobName: string, updates: Partial<Pick<SchedulerJob, 'schedule' | 'enabled'>>) => {
        setLoadingJobName(jobName);
        setFeedback(null);

        try {
            await updateSchedulerJob(token, jobName, updates);

            setFeedback({
                jobName,
                type: 'success',
                message: 'Job updated successfully'
            });

            await fetchData();
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to update job';
            setFeedback({
                jobName,
                type: 'error',
                message
            });
        } finally {
            setLoadingJobName(null);
            setTimeout(() => {
                setFeedback(prev => prev?.jobName === jobName ? null : prev);
            }, 3000);
        }
    };

    const handleToggleEnabled = async (jobName: string, enabled: boolean) => {
        await handleUpdateJob(jobName, { enabled });
    };

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

        await handleUpdateJob(jobName, { schedule: newSchedule });
    };

    const filteredJobs = jobFilter
        ? jobs.filter(job => {
            if (Array.isArray(jobFilter)) {
                return jobFilter.includes(job.name);
            }
            return jobFilter(job);
        })
        : jobs;

    const enabledCount = filteredJobs.filter(j => j.enabled).length;
    const runningCount = filteredJobs.filter(j => j.status === 'running').length;
    const failedCount = filteredJobs.filter(j => j.status === 'failed').length;

    if (loading) {
        return (
            <Page>
                <div className={styles.empty_state}>
                    Loading scheduler data...
                </div>
            </Page>
        );
    }

    return (
        <Page>
            <Stack gap="md">
                {error && (
                    <div className={styles.alert_error}>
                        <AlertCircle size={16} />
                        {error}
                    </div>
                )}

                {!hideStats && (
                    <div className={styles.stats_bar}>
                        <div className={styles.stat}>
                            <span className={styles.stat_value}>{filteredJobs.length}</span>
                            <span className={styles.stat_label}>Total</span>
                        </div>
                        <div className={styles.stat_divider} />
                        <div className={styles.stat}>
                            <span className={`${styles.stat_value} ${styles.stat_success}`}>{enabledCount}</span>
                            <span className={styles.stat_label}>Enabled</span>
                        </div>
                        {runningCount > 0 && (
                            <>
                                <div className={styles.stat_divider} />
                                <div className={styles.stat}>
                                    <span className={`${styles.stat_value} ${styles.stat_primary}`}>{runningCount}</span>
                                    <span className={styles.stat_label}>Running</span>
                                </div>
                            </>
                        )}
                        {failedCount > 0 && (
                            <>
                                <div className={styles.stat_divider} />
                                <div className={styles.stat}>
                                    <span className={`${styles.stat_value} ${styles.stat_danger}`}>{failedCount}</span>
                                    <span className={styles.stat_label}>Failed</span>
                                </div>
                            </>
                        )}
                        {health && (
                            <>
                                <div className={styles.stat_divider} />
                                <div className={styles.stat}>
                                    <span className={styles.stat_value}>{health.successRate?.toFixed(0) ?? '--'}%</span>
                                    <span className={styles.stat_label}>Success Rate</span>
                                </div>
                            </>
                        )}
                    </div>
                )}

                {filteredJobs.length === 0 ? (
                    <div className={styles.empty_state}>
                        {jobFilter ? 'No jobs match the filter criteria.' : 'No scheduled jobs found.'}
                    </div>
                ) : (
                    <Table>
                        <Thead>
                            <Tr>
                                <Th width="shrink"></Th>
                                <Th>Job</Th>
                                <Th className={styles.th_schedule}>Schedule</Th>
                                <Th width="shrink">Status</Th>
                                <Th width="shrink" className={styles.th_last_run}>Last Run</Th>
                                <Th width="shrink" className={styles.th_enabled}>Enabled</Th>
                            </Tr>
                        </Thead>
                        <Tbody>
                            {filteredJobs.map(job => (
                                <JobRow
                                    key={job.name}
                                    job={job}
                                    onToggleEnabled={handleToggleEnabled}
                                    onScheduleChange={handleScheduleChange}
                                    isLoading={!!loadingJobName}
                                    loadingJobName={loadingJobName}
                                    feedback={feedback}
                                />
                            ))}
                        </Tbody>
                    </Table>
                )}
            </Stack>
        </Page>
    );
}
