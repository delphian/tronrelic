/**
 * Published contract for the scheduler's admin-facing job readout and for
 * the `SchedulerMonitor` component that renders it.
 *
 * Why these types live in the types package rather than beside the
 * component: `SchedulerMonitor` is republished to plugins on
 * `context.system`, so its props and the job shape its filter predicate
 * receives are part of the platform's public surface. Declaring them here
 * and importing them from the implementation gives both sides one
 * definition. The previous arrangement — an inline prop shape written by
 * hand in `ISystemComponents` and a separate local `Props` interface in
 * the component — drifted silently, because an all-optional props type
 * makes the structural check that connects them almost vacuous.
 */

/**
 * A single scheduled job as reported by `GET /api/admin/system/scheduler/status`.
 *
 * Consumers use this to identify and filter jobs; a plugin typically cares
 * only about `name`, but the whole row is published so a filter predicate
 * can select on state (for example, surfacing only failing jobs).
 */
export interface ISchedulerJobStatus {
    /** Unique job identifier (e.g., 'blockchain:sync', 'onchain-patterns:derivation'). */
    name: string;

    /** Cron expression defining the schedule (e.g., '0 0 * * *' for daily). */
    schedule: string;

    /** Whether the job is currently enabled. */
    enabled: boolean;

    /** ISO timestamp of the last execution, null if never run. */
    lastRun: string | null;

    /** ISO timestamp of the next scheduled execution, null if unknown. */
    nextRun: string | null;

    /** Current execution status. */
    status: 'running' | 'success' | 'failed' | 'never_run';

    /** Duration of the last execution in seconds, null if never run. */
    duration: number | null;

    /** Error message from the last failed execution, null if it succeeded. */
    error: string | null;
}

/**
 * Props accepted by the `SchedulerMonitor` component published on
 * `context.system`.
 *
 * The component authenticates through the caller's admin session cookie,
 * so there is deliberately no token prop: passing one would imply an
 * authorization decision the component does not make.
 */
export interface ISchedulerMonitorProps {
    /**
     * Restricts the table to specific jobs. Supply job names for the common
     * case, or a predicate when the selection depends on a naming convention
     * (for example, every job whose name starts with your plugin id).
     * Omit to show every job on the platform.
     */
    jobFilter?: string[] | ((job: ISchedulerJobStatus) => boolean);

    /**
     * Heading for the stats bar. Override it when the monitor is embedded in
     * a page whose own heading would otherwise be ambiguous.
     */
    title?: string;

    /**
     * Hides the aggregate stats bar. Set this when embedding the monitor as
     * one tab among several, where platform-wide totals would misrepresent
     * the handful of jobs on screen.
     */
    hideStats?: boolean;
}
