'use client';

/**
 * @fileoverview SchedulerMonitor: the scheduled-job table behind every
 * Schedules tab and the whole of /system/scheduler.
 *
 * Operators use it to find failed jobs, see when each job ran, and change a
 * schedule or switch a job off without a redeploy. It is an admin-only surface
 * authorized by the session cookie, so it fetches on the client and shows a
 * loading line rather than following the SSR pattern for public pages.
 *
 * The component is embedded as a tab on many admin pages and handed to plugins
 * on `context.system`, so it draws one `Panel`, never a `<Page>`: the host page
 * owns the single page wrapper, and the panel matches the storage browsers on
 * a Database tab. On a phone the table stacks each job into a labelled entry
 * rather than hiding columns, because the Schedule column is the only place a
 * cron schedule can be edited.
 *
 * @module modules/scheduler/components/SchedulerMonitor
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ChevronDown, ChevronRight, AlertCircle, Play } from 'lucide-react';
import { Badge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Input } from '../../../../components/ui/Input';
import { Panel } from '../../../../components/ui/Panel';
import { Switch } from '../../../../components/ui/Switch';
import { StatGrid, StatTile } from '../../../../components/ui/StatTile';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../components/ui/Table';
import { ClientTime } from '../../../../components/ui/ClientTime';
import { getSchedulerStatus, getSchedulerHealth, updateSchedulerJob, runSchedulerJob } from '../../api';
import type { ISchedulerMonitorProps } from '@/types';
import type { SchedulerJob, SchedulerHealth } from '../../types';
import styles from './SchedulerMonitor.module.scss';

/** How often the table re-reads job status, so a run that finishes shows without a reload. */
const REFRESH_INTERVAL_MS = 10_000;

/** How long a change's result message stays in the job's details row. */
const FEEDBACK_CLEAR_MS = 3_000;

/**
 * The narrowest the schedule input gets, in characters. Wide enough for a
 * typical five-field expression with room to type, so a list of short
 * schedules does not produce a field too small to edit.
 */
const MIN_SCHEDULE_CHARS = 14;

/**
 * The widest the schedule input gets, in characters. Sizing every row to a
 * rare long expression, such as a 41-character list of minutes, took the
 * width the job names needed at tablet size and squeezed them under the
 * switch beside them. A longer expression scrolls inside its field and shows
 * whole in the field's tooltip.
 */
const MAX_SCHEDULE_CHARS = 24;

/** Columns every row has: Job, Enabled, Schedule, Status, Last run, and Run. */
const BASE_COLUMN_COUNT = 6;

/** The status badge's tone for each job status. */
const STATUS_TONE: Record<SchedulerJob['status'], 'success' | 'danger' | 'warning' | 'neutral'> = {
    success: 'success',
    failed: 'danger',
    running: 'warning',
    never_run: 'neutral'
};

/**
 * Where each status sorts in the table. Failed jobs come first because they
 * are what an operator opens the page to find; every other job keeps the
 * order the scheduler reported it in. Running jobs are not lifted: a job is
 * running for a few seconds at a time, so ranking it would move rows up and
 * back down between refreshes.
 */
const STATUS_RANK: Record<SchedulerJob['status'], number> = {
    failed: 0,
    running: 1,
    success: 1,
    never_run: 1
};

/**
 * The result of the last change an operator made to one job, shown in that
 * job's details row for a few seconds.
 */
interface IJobFeedback {
    /** The job the message is about. */
    jobName: string;
    /** Whether the change went through. */
    type: 'success' | 'error';
    /** What happened, in words the operator can act on. */
    message: string;
}

/**
 * Put jobs in display order: failed first, then the rest, each group in the
 * order the scheduler reported it.
 *
 * While the operator is typing in a schedule field the order already on screen
 * is held instead. React moves a row's DOM node when the row changes position,
 * and moving the row that holds the focused input takes focus away mid-edit,
 * which can commit a half-typed schedule through the input's blur handler.
 * Jobs the held order does not contain go after it, in status order.
 *
 * @param jobs - The jobs from the latest status response.
 * @param heldOrder - The jobs as currently listed, to keep while a schedule is
 *        being edited; null to sort afresh.
 * @returns The jobs in the order the table lists them.
 */
function orderJobsForDisplay(jobs: SchedulerJob[], heldOrder: SchedulerJob[] | null): SchedulerJob[] {
    const ranked = [...jobs].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);
    let ordered = ranked;

    if (heldOrder !== null) {
        const position = new Map(heldOrder.map((job, index) => [job.name, index]));
        const unplaced = heldOrder.length;
        ordered = [...ranked].sort(
            (a, b) => (position.get(a.name) ?? unplaced) - (position.get(b.name) ?? unplaced)
        );
    }

    return ordered;
}

/**
 * Find the namespace every listed job name starts with, so each row can drop
 * it. A filtered Schedules tab usually lists one component's jobs, and every
 * row repeating the same `component-id:` spends width on text the tab title
 * already gives.
 *
 * The prefix ends at a colon, which is where job names separate their
 * namespace from the job, and it is only returned when every name has text
 * left after it.
 *
 * @param names - The names of every job on screen.
 * @returns The shared prefix including its colon, or an empty string when the
 *          names share none.
 */
function sharedJobNamePrefix(names: string[]): string {
    let common = names[0] ?? '';
    for (const name of names) {
        while (!name.startsWith(common)) {
            common = common.slice(0, -1);
        }
    }

    const namespace = common.slice(0, common.lastIndexOf(':') + 1);
    const leavesEveryNameText = names.every(name => name.length > namespace.length);

    return leavesEveryNameText ? namespace : '';
}

/**
 * Width of the schedule input in characters, shared by every row so the column
 * has one even edge. It fits the longest schedule on screen plus one character
 * for the caret, between MIN_SCHEDULE_CHARS and MAX_SCHEDULE_CHARS.
 *
 * @param jobs - The jobs on screen.
 * @returns The input width, in `ch`.
 */
function scheduleInputChars(jobs: SchedulerJob[]): number {
    const longest = Math.max(MIN_SCHEDULE_CHARS, ...jobs.map(job => job.schedule.length + 1));
    return Math.min(MAX_SCHEDULE_CHARS, longest);
}

/**
 * Props for one job's row and the details row it opens.
 */
interface IJobRowProps {
    /** The job to render. */
    job: SchedulerJob;
    /** Shared namespace dropped from the displayed name; empty to show the name whole. */
    namePrefix: string;
    /** Whether the table has a Next run column, which the row has to match. */
    showNextRun: boolean;
    /** Number of columns in the table, so the details row spans all of them. */
    columnCount: number;
    /** Switches the job on or off. */
    onToggleEnabled: (jobName: string, enabled: boolean) => void;
    /** Commits an edited schedule. */
    onScheduleChange: (jobName: string, schedule: string) => void;
    /** Reports that a schedule field gained or lost focus, so the monitor can hold the row order. */
    onScheduleFocusChange: (focused: boolean) => void;
    /** Starts an out-of-schedule run. */
    onRunNow: (jobName: string) => void;
    /** True while any job change is in flight, which disables every row's controls. */
    isLoading: boolean;
    /** The job whose change is in flight, if any. */
    loadingJobName: string | null;
    /** The latest change result, shown only on the row it names. */
    feedback: IJobFeedback | null;
}

/**
 * One job as a table row, plus the details row it opens.
 *
 * The job cell holds the expand toggle, the name, and for a failed job the
 * first line of its error, so the reason for a failure reads without opening
 * the row. The Enabled cell comes straight after it and the Run cell closes the
 * row, both without a label. When the table stacks on a phone, the shared
 * Table puts unlabelled cells that open a row on the entry's first line and
 * those that close it at the end of its last line, so the switch sits beside
 * the name and the run button after the last value, rather than each taking a
 * labelled line of its own.
 *
 * @param props - The job, its display options, and the monitor's callbacks, as
 *        described on IJobRowProps.
 * @returns The job's row and, when expanded, its details row.
 */
function JobRow({
    job,
    namePrefix,
    showNextRun,
    columnCount,
    onToggleEnabled,
    onScheduleChange,
    onScheduleFocusChange,
    onRunNow,
    isLoading,
    loadingJobName,
    feedback
}: IJobRowProps) {
    const [expanded, setExpanded] = useState(false);
    const isThisLoading = loadingJobName === job.name;
    const jobFeedback = feedback?.jobName === job.name ? feedback : null;
    const isFailed = job.status === 'failed';

    return (
        <>
            <Tr hasError={isFailed}>
                <Td>
                    <div className={styles.job_cell}>
                        <button
                            type="button"
                            onClick={() => setExpanded(!expanded)}
                            className={styles.expand_btn}
                            aria-expanded={expanded}
                            aria-label={expanded ? 'Collapse details' : 'Expand details'}
                        >
                            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </button>
                        <span className={styles.job_name} title={namePrefix ? job.name : undefined}>
                            {job.name.slice(namePrefix.length)}
                            {isFailed && (
                                <AlertCircle size={14} className={styles.error_icon} aria-hidden />
                            )}
                        </span>
                        {isFailed && job.error && (
                            <span className={styles.job_error} title={job.error}>
                                {job.error}
                            </span>
                        )}
                    </div>
                </Td>
                <Td className={styles.cell_enabled}>
                    <Switch
                        on={job.enabled}
                        onChange={(next) => onToggleEnabled(job.name, next)}
                        disabled={isLoading || isThisLoading}
                        aria-label={`${job.enabled ? 'Disable' : 'Enable'} ${job.name}`}
                    />
                </Td>
                <Td label="Schedule" className={styles.cell_schedule}>
                    <Input
                        type="text"
                        defaultValue={job.schedule}
                        onFocus={() => onScheduleFocusChange(true)}
                        onBlur={(e) => {
                            onScheduleFocusChange(false);
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
                        title={job.schedule}
                        aria-label={`Schedule for ${job.name}`}
                    />
                </Td>
                <Td label="Status">
                    <Badge tone={STATUS_TONE[job.status]}>
                        {job.status.replace('_', ' ')}
                    </Badge>
                </Td>
                <Td label="Last run" muted>
                    {job.lastRun ? (
                        <ClientTime date={job.lastRun} format="relative" />
                    ) : (
                        <span className={styles.never_run}>Never</span>
                    )}
                </Td>
                {showNextRun && (
                    <Td label="Next run" muted>
                        {/* Relative ("in 10m") rather than a full date and time,
                            which was about three times as wide and took the
                            width the job names needed at tablet size. */}
                        <ClientTime date={job.nextRun} format="relative" />
                    </Td>
                )}
                <Td className={styles.cell_actions}>
                    {/* Manual run is an out-of-schedule trigger — useful when a
                        low-frequency job (e.g. a 4-hourly snapshot) has not yet
                        reached its first boundary. Disabled while any update is in
                        flight or this job is already running, since the backend
                        rejects a stacked run anyway. */}
                    <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => onRunNow(job.name)}
                        disabled={isLoading || isThisLoading || job.status === 'running'}
                        aria-label={`Run ${job.name} now`}
                        title="Run now"
                    >
                        <Play size={14} aria-hidden />
                    </Button>
                </Td>
            </Tr>
            {expanded && (
                <Tr isExpanded>
                    <Td colSpan={columnCount}>
                        <div className={styles.details_content}>
                            {jobFeedback && (
                                <div className={jobFeedback.type === 'success' ? styles.alert_success : styles.alert_error}>
                                    {jobFeedback.type === 'error' && <AlertCircle size={14} />}
                                    {jobFeedback.message}
                                </div>
                            )}

                            <div className={styles.details_grid}>
                                {namePrefix && (
                                    <div className={styles.detail_item}>
                                        <span className={styles.detail_label}>Job</span>
                                        <span className={styles.detail_name}>{job.name}</span>
                                    </div>
                                )}
                                {job.duration !== null && (
                                    <div className={styles.detail_item}>
                                        <span className={styles.detail_label}>Duration</span>
                                        <span className={styles.detail_value}>{job.duration.toFixed(2)}s</span>
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
 * Admin diagnostic tool for monitoring scheduled job health and execution.
 * Lists jobs in a table with inline controls and expandable details, failed
 * jobs first, inside a titled panel with an optional stats strip. The panel's
 * meta line gives the job count and, when the rows drop a shared namespace,
 * states it once.
 *
 * The stats strip counts only the jobs on screen. The success rate is the
 * scheduler's figure across every job's recorded runs, and the status response
 * carries nothing per job to scope it with, so it appears only on the
 * unfiltered monitor and the health endpoint is only called there.
 *
 * Props come from the published {@link ISchedulerMonitorProps} rather than a
 * local interface, because this component is republished to plugins on
 * `context.system`. A second, hand-maintained copy of the shape is what let
 * the plugin-facing declaration drift out of sync with this signature once
 * already — an all-optional props type makes the structural check between
 * them nearly vacuous, so the compiler will not catch the next divergence.
 *
 * @param props - Component props
 * @param props.jobFilter - Restricts the table to these jobs; when set, a
 *        namespace every listed name shares is dropped from the names
 * @param props.title - Title of the monitor's panel; "Scheduled Jobs" when omitted
 * @param props.hideStats - Hide the stats strip when embedding
 * @returns The panel holding the stats strip and job table.
 */
export function SchedulerMonitor({ jobFilter, title = 'Scheduled Jobs', hideStats = false }: ISchedulerMonitorProps) {
    const [jobs, setJobs] = useState<SchedulerJob[]>([]);
    const [health, setHealth] = useState<SchedulerHealth | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingJobName, setLoadingJobName] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<IJobFeedback | null>(null);

    // True while a schedule field has focus. A ref rather than state because
    // only the refresh reads it, and changing it must not re-render the table.
    const isEditingScheduleRef = useRef(false);

    const showSuccessRate = !hideStats && jobFilter === undefined;

    /**
     * Fetches job status, plus scheduler health when the success rate is
     * shown, and puts the jobs in display order. The order on screen is held
     * while a schedule field has focus; see orderJobsForDisplay.
     */
    const fetchData = useCallback(async (): Promise<void> => {
        try {
            const [jobsData, healthData] = await Promise.all([
                getSchedulerStatus(),
                showSuccessRate ? getSchedulerHealth() : Promise.resolve(null)
            ]);
            const holdOrder = isEditingScheduleRef.current;
            setJobs(previous => orderJobsForDisplay(jobsData, holdOrder ? previous : null));
            setHealth(healthData);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch scheduler data');
        } finally {
            setLoading(false);
        }
    }, [showSuccessRate]);

    /**
     * Loads the table on mount and re-reads it every REFRESH_INTERVAL_MS, so
     * a run that starts or finishes shows without a reload. The returned
     * cleanup stops the timer when the monitor unmounts or the fetch changes.
     */
    useEffect(() => {
        void fetchData();
        const interval = setInterval(fetchData, REFRESH_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [fetchData]);

    /**
     * Checks that an edited cron expression has a field count the backend can
     * actually run, so the browser does not reject a schedule the scheduler
     * would have accepted. node-cron supports both the standard five-field form
     * and a six-field form whose leading field is seconds, and several jobs are
     * registered with six fields — the address-tags ingestion jobs among them.
     * Requiring exactly five left those schedules visible on an admin page but
     * impossible to edit, and the failure surfaced only as a client-side
     * validation message that never reached the API.
     *
     * @param schedule The expression as typed into the schedule input, which may
     *                 carry stray whitespace from a paste.
     * @returns True when the expression has five or six fields. This is only a
     *          shape check; node-cron validates the field values themselves when
     *          the job is rescheduled, and a bad value surfaces as an API error.
     */
    const isValidCronExpression = (schedule: string): boolean => {
        const fields = schedule.trim().split(/\s+/);
        const result = fields.length === 5 || fields.length === 6;

        return result;
    };

    /**
     * Clears a job's result message after FEEDBACK_CLEAR_MS, so the details
     * row does not keep reporting a change the operator has already seen. A
     * message that has since been replaced by one about another job is left.
     *
     * @param jobName - The job whose message should clear.
     */
    const clearFeedbackLater = (jobName: string): void => {
        setTimeout(() => {
            setFeedback(prev => prev?.jobName === jobName ? null : prev);
        }, FEEDBACK_CLEAR_MS);
    };

    /**
     * Updates a scheduler job's configuration via the admin API, reports the
     * result on the job's row, and re-reads the table so the row shows the
     * stored values.
     *
     * @param jobName - The job to change.
     * @param updates - The new schedule, enabled flag, or both.
     */
    const handleUpdateJob = async (jobName: string, updates: Partial<Pick<SchedulerJob, 'schedule' | 'enabled'>>): Promise<void> => {
        setLoadingJobName(jobName);
        setFeedback(null);

        try {
            await updateSchedulerJob(jobName, updates);

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
            clearFeedbackLater(jobName);
        }
    };

    /**
     * Switches a job on or off from its row's switch.
     *
     * @param jobName - The job to change.
     * @param enabled - The state the operator switched it to.
     */
    const handleToggleEnabled = async (jobName: string, enabled: boolean): Promise<void> => {
        await handleUpdateJob(jobName, { enabled });
    };

    /**
     * Triggers an immediate, out-of-schedule run of a job, then refreshes the
     * table so the status badge reflects the new execution. Feedback is driven off
     * the run response (started vs already-running) rather than the status badge,
     * because a disabled job's badge is masked to "never run" by the status
     * endpoint and would not reflect a manual run.
     *
     * @param jobName - The job to run now.
     */
    const handleRunNow = async (jobName: string): Promise<void> => {
        setLoadingJobName(jobName);
        setFeedback(null);

        try {
            const { started } = await runSchedulerJob(jobName);
            setFeedback({
                jobName,
                type: 'success',
                message: started ? 'Run started' : 'Job is already running'
            });
            await fetchData();
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to run job';
            setFeedback({ jobName, type: 'error', message });
        } finally {
            setLoadingJobName(null);
            clearFeedbackLater(jobName);
        }
    };

    /**
     * Commits an edited schedule, or reports on the row why it was not sent
     * when it does not have five or six fields.
     *
     * @param jobName - The job whose schedule was edited.
     * @param newSchedule - The trimmed expression from the input.
     */
    const handleScheduleChange = async (jobName: string, newSchedule: string): Promise<void> => {
        if (isValidCronExpression(newSchedule)) {
            await handleUpdateJob(jobName, { schedule: newSchedule });
        } else {
            setFeedback({
                jobName,
                type: 'error',
                message: 'Invalid cron expression. Must have 5 or 6 space-separated fields.'
            });
            clearFeedbackLater(jobName);
        }
    };

    /**
     * Records whether a schedule field has focus, so a refresh that lands
     * while the operator is typing keeps the rows where they are.
     *
     * @param focused - True when a schedule field gained focus, false when it lost it.
     */
    const handleScheduleFocusChange = (focused: boolean): void => {
        isEditingScheduleRef.current = focused;
    };

    const filteredJobs = jobFilter
        ? jobs.filter(job => (Array.isArray(jobFilter) ? jobFilter.includes(job.name) : jobFilter(job)))
        : jobs;

    const enabledCount = filteredJobs.filter(j => j.enabled).length;
    const runningCount = filteredJobs.filter(j => j.status === 'running').length;
    const failedCount = filteredJobs.filter(j => j.status === 'failed').length;

    // The unfiltered page lists every component's jobs, so names keep their
    // namespace there; it is what tells one component's jobs from another's.
    const namePrefix = jobFilter ? sharedJobNamePrefix(filteredJobs.map(job => job.name)) : '';

    // A disabled job has no next run, and a column of nothing but dashes
    // would only take width from the others.
    const showNextRun = filteredJobs.some(job => job.nextRun !== null);
    const columnCount = BASE_COLUMN_COUNT + (showNextRun ? 1 : 0);

    // Read by the schedule input's width rule in the stylesheet.
    const tableStyle = { '--scheduler-monitor-schedule-chars': scheduleInputChars(filteredJobs) } as CSSProperties;

    // The panel's meta line. The namespace the rows drop is stated here once,
    // as the storage browsers state the collection prefix their rows drop.
    const meta = loading ? undefined : (
        <>
            {namePrefix && (
                <>
                    <span className={styles.identifier}>{`${namePrefix}*`}</span>
                    {' · '}
                </>
            )}
            {filteredJobs.length} {filteredJobs.length === 1 ? 'job' : 'jobs'}
        </>
    );

    const successRate = showSuccessRate ? health?.successRate : undefined;

    // `surface={false}`: the panel is already the card, and a box around each
    // figure inside it would read as boxes inside a box.
    const stats = hideStats ? null : (
        <StatGrid size="sm">
            <StatTile size="sm" surface={false} label="Total" value={filteredJobs.length} />
            <StatTile size="sm" surface={false} label="Enabled" value={enabledCount} />
            {runningCount > 0 && <StatTile size="sm" surface={false} label="Running" value={runningCount} tone="primary" />}
            {failedCount > 0 && <StatTile size="sm" surface={false} label="Failed" value={failedCount} tone="danger" />}
            {successRate !== undefined && (
                <StatTile
                    size="sm"
                    surface={false}
                    label="Success rate"
                    value={`${successRate.toFixed(0)}%`}
                    note="all recorded runs"
                />
            )}
        </StatGrid>
    );

    let body: ReactNode;
    if (loading) {
        body = <p className={styles.message}>Loading scheduler data…</p>;
    } else {
        body = (
            <>
                {error && (
                    <div className={styles.alert_error} role="alert">
                        <AlertCircle size={16} aria-hidden />
                        {error}
                    </div>
                )}

                {stats}

                {filteredJobs.length === 0 ? (
                    <p className={styles.message}>
                        {jobFilter ? 'No jobs match the filter criteria.' : 'No scheduled jobs found.'}
                    </p>
                ) : (
                    /* `flush` because the table is the last thing in the panel
                       and fills its width, so the panel's card is its border. */
                    <Table flush stackAt="mobile" style={tableStyle}>
                        <Thead>
                            <Tr>
                                <Th width="expand">Job</Th>
                                <Th width="shrink" className={styles.th_enabled}>Enabled</Th>
                                <Th width="shrink">Schedule</Th>
                                <Th width="shrink">Status</Th>
                                <Th width="shrink">Last run</Th>
                                {showNextRun && <Th width="shrink">Next run</Th>}
                                <Th width="shrink" className={styles.th_actions}>Run</Th>
                            </Tr>
                        </Thead>
                        <Tbody>
                            {filteredJobs.map(job => (
                                <JobRow
                                    key={job.name}
                                    job={job}
                                    namePrefix={namePrefix}
                                    showNextRun={showNextRun}
                                    columnCount={columnCount}
                                    onToggleEnabled={handleToggleEnabled}
                                    onScheduleChange={handleScheduleChange}
                                    onScheduleFocusChange={handleScheduleFocusChange}
                                    onRunNow={handleRunNow}
                                    isLoading={!!loadingJobName}
                                    loadingJobName={loadingJobName}
                                    feedback={feedback}
                                />
                            ))}
                        </Tbody>
                    </Table>
                )}
            </>
        );
    }

    return (
        <Panel title={title} titleAs="h3" meta={meta}>
            {body}
        </Panel>
    );
}
