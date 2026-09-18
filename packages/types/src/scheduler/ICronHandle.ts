/**
 * @fileoverview Handle to one live cron schedule created by an `ICronTrigger`.
 *
 * @module types/scheduler/ICronHandle
 */

/**
 * Handle to one live cron schedule.
 *
 * The scheduler has to be able to cancel a schedule when an operator disables
 * or reschedules a job, when a plugin unregisters it, and at shutdown. This
 * handle is the only thing the scheduler keeps from the trigger, so the
 * scheduler never holds a reference to a cron library's own task object.
 */
export interface ICronHandle {
    /**
     * Cancel the schedule permanently.
     *
     * After this returns, the trigger must not call either callback for this
     * schedule again, and must release anything it holds for it. A cancelled
     * handle is not restarted; the scheduler asks the trigger for a new one.
     */
    stop(): void;
}
