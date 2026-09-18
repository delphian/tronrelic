/**
 * @fileoverview `ICronTrigger` adapter over the node-cron library.
 *
 * This is the only file in the backend that imports node-cron. The scheduler
 * service depends on `ICronTrigger`, so everything specific to the library —
 * its task objects, its event names, and its registry of live tasks — stays in
 * this file.
 *
 * @module modules/scheduler/services/NodeCronTrigger
 */

import { createTask } from 'node-cron';
import type { ICronHandle, ICronTrigger, ICronTriggerCallbacks } from '@/types';

/**
 * Runs cron schedules on node-cron version 4.
 *
 * Version 4 is required, not preferred. Version 3 checked the clock on a
 * one-second polling loop, and with `recoverMissedExecutions` turned on it
 * looked back one second on every poll and fired the second it had just fired
 * again, so every job ran twice. Version 4 calculates the next matching time
 * and sleeps until then, plans each scheduled time exactly once, still runs a
 * time it wakes up to for up to one second late, and reports anything later
 * through its `execution:missed` event instead of replaying it.
 *
 * The adapter does not decide what a missed time means. It passes each one to
 * `onMissed` and lets the scheduler service choose whether to run the job.
 */
export class NodeCronTrigger implements ICronTrigger {
    /**
     * Create and start a node-cron task for one expression.
     *
     * The task is created stopped so the missed-time listener is attached
     * before the first heartbeat can fire. Attaching that listener also stops
     * node-cron from printing its own missed-execution warning to the console,
     * which is correct here because the scheduler logs the event itself.
     *
     * The task callback hands the scheduled time to `onSlot` and returns
     * straight away. The scheduler runs the job without waiting on it, so
     * node-cron never sees a task as still busy, and overlap protection stays
     * in one place in the scheduler service.
     *
     * @param expression - Cron expression in five- or six-field form. node-cron
     *                     pads a five-field expression with a seconds value of 0.
     * @param callbacks - Where to report each scheduled time and each missed one.
     * @returns A handle whose `stop()` destroys the task.
     * @throws Error from node-cron when the expression is invalid.
     */
    schedule(expression: string, callbacks: ICronTriggerCallbacks): ICronHandle {
        const task = createTask(expression, (context) => {
            callbacks.onSlot(context.date);
        });

        task.on('execution:missed', (context) => {
            callbacks.onMissed(context.date);
        });

        void task.start();

        return {
            /**
             * Destroy the task rather than only stopping it.
             *
             * node-cron keeps every task it creates in a module-level registry
             * until the task is destroyed. Stopping alone would leave one dead
             * entry behind each time an operator reschedules or disables a job.
             */
            stop: (): void => {
                void task.destroy();
            }
        };
    }
}
