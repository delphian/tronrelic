/**
 * @fileoverview Callbacks an `ICronTrigger` calls when a scheduled time arrives or is missed.
 *
 * @module types/scheduler/ICronTriggerCallbacks
 */

/**
 * Callbacks an `ICronTrigger` calls for one schedule.
 *
 * Both callbacks receive the scheduled time (the slot) rather than the time
 * the callback happened to run. The scheduler uses the slot to make sure each
 * scheduled time starts at most one run, whatever the trigger does, so the
 * value must be the exact time the cron expression matched, with milliseconds
 * set to zero.
 */
export interface ICronTriggerCallbacks {
    /**
     * Called once when a scheduled time arrives, or arrives slightly late but
     * within the trigger's tolerance.
     *
     * @param slot - The scheduled time that matched the cron expression.
     */
    onSlot(slot: Date): void;

    /**
     * Called for a scheduled time the trigger could not honour on time, for
     * example because the event loop was blocked past the trigger's tolerance.
     *
     * The scheduler decides whether a missed time still deserves a run, so a
     * trigger reports every missed time and does not run anything itself.
     *
     * @param slot - The scheduled time that was missed.
     */
    onMissed(slot: Date): void;
}
