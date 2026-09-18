/**
 * @fileoverview Contract for the component that turns a cron expression into timed callbacks.
 *
 * @module types/scheduler/ICronTrigger
 */

import type { ICronHandle } from './ICronHandle.js';
import type { ICronTriggerCallbacks } from './ICronTriggerCallbacks.js';

/**
 * Turns a cron expression into timed callbacks for the scheduler.
 *
 * The scheduler service owns the job rules: overlap protection, execution
 * records, and running each scheduled time at most once. Working out when a
 * cron expression matches is a separate concern that a cron library handles.
 * Keeping the two apart behind this interface means a library's timing quirks
 * stay inside one adapter, a library can be replaced without touching the
 * scheduler, and tests can drive the scheduler with exact scheduled times
 * instead of waiting on a real clock.
 *
 * Implementations must accept both the five-field form
 * (`minute hour day-of-month month day-of-week`) and the six-field form whose
 * leading field is seconds, because stored schedules use both.
 */
export interface ICronTrigger {
    /**
     * Start calling back on every time the expression matches.
     *
     * @param expression - Cron expression to follow, in five- or six-field form.
     * @param callbacks - Where to report each scheduled time, and each one missed.
     * @returns A handle the caller uses to cancel the schedule.
     * @throws Error when the expression is not a valid cron expression, so a bad
     *         schedule fails when it is set rather than silently never firing.
     */
    schedule(expression: string, callbacks: ICronTriggerCallbacks): ICronHandle;
}
