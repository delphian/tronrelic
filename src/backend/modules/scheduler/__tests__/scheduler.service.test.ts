/**
 * @fileoverview Unit tests for SchedulerService: runNow, the shared executeJob
 * path, and how scheduled and missed times turn into runs.
 *
 * Why these exist: runNow is the on-demand trigger behind the dashboard "Run now"
 * button, and it shares one execution path with the cron tick (executeJob). The
 * contract that matters operationally is single-flight (a manual run never stacks
 * a second concurrent execution on top of an in-flight run) and never-throw (a
 * failing handler is recorded, not propagated, and always releases the running
 * lock so the job is not wedged into a permanently-skipped state).
 *
 * The slot tests pin the fix for the node-cron 3 double fire, where every job
 * ran twice one second apart: each scheduled time starts at most one run, and
 * missed times produce a single catch-up run rather than one per missed time.
 * A fake ICronTrigger delivers exact scheduled times, so no real clock is used.
 * The database is the shared in-memory mock with a spied model, so no live
 * MongoDB is required.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import type { ICronHandle, ICronTrigger, ICronTriggerCallbacks } from '@/types';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { SchedulerService } from '../services/scheduler.service.js';

/**
 * Drain pending micro/macro tasks so a fire-and-forget executeJob() reaches its
 * `finally` (lock release) before assertions run, and so a deferred missed
 * time (handled on setImmediate) has been processed.
 *
 * @returns A promise that resolves after several event-loop turns.
 */
async function flush(): Promise<void> {
    for (let i = 0; i < 4; i += 1) {
        await new Promise((resolve) => setImmediate(resolve));
    }
}

/**
 * ICronTrigger stand-in that records each schedule's callbacks so a test can
 * deliver scheduled and missed times by hand.
 *
 * A real trigger follows the clock, which would make these tests slow and
 * timing-dependent. Recording the callbacks lets a test reproduce exactly the
 * sequence that caused the production double fire.
 */
class FakeCronTrigger implements ICronTrigger {
    readonly schedules: Array<{ expression: string; callbacks: ICronTriggerCallbacks; stopped: boolean }> = [];

    /**
     * Record the schedule instead of starting a timer.
     *
     * @param expression - Cron expression the scheduler asked for, kept so a
     *                     test can check which schedule was requested.
     * @param callbacks - The scheduler's callbacks, which the test calls to
     *                    simulate the trigger firing.
     * @returns A handle that marks the recorded schedule as stopped.
     */
    schedule(expression: string, callbacks: ICronTriggerCallbacks): ICronHandle {
        const entry = { expression, callbacks, stopped: false };
        this.schedules.push(entry);
        return {
            /**
             * Mark the schedule stopped so a test can assert the scheduler
             * cancelled it.
             */
            stop: (): void => {
                entry.stopped = true;
            }
        };
    }

    /**
     * Return the callbacks of the most recent schedule, which is the live one
     * for a job registered once.
     *
     * @returns The latest recorded callbacks.
     */
    latest(): ICronTriggerCallbacks {
        return this.schedules[this.schedules.length - 1].callbacks;
    }
}

/**
 * Build a handler that stays running until the test releases it.
 *
 * Overlap and catch-up behaviour depends on a run still being in progress when
 * the next time arrives, so the test needs control over when a run ends.
 *
 * @returns The spied handler and a function that lets the parked run finish.
 */
function createGatedHandler(): { handler: Mock<() => Promise<void>>; release: () => void } {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const handler = vi.fn(async (): Promise<void> => {
        await gate;
    });
    return { handler, release };
}

describe('SchedulerService', () => {
    let mockDb: ReturnType<typeof createMockDatabaseService>;
    let trigger: FakeCronTrigger;

    /**
     * Fresh singleton, a fake trigger, and a spied model before each test. The
     * model's findOne() reports no stored config so start() writes the default,
     * and create() returns a doc whose updateOne() is a no-op, which is what
     * both config creation and executeJob's execution record need.
     */
    beforeEach(() => {
        SchedulerService.resetInstance();
        mockDb = createMockDatabaseService();
        trigger = new FakeCronTrigger();
        vi.spyOn(mockDb, 'getModel').mockReturnValue({
            findOne: vi.fn(async () => null),
            create: vi.fn(async (doc: unknown) => ({ ...(doc as object), updateOne: vi.fn(async () => {}) }))
        } as never);
        SchedulerService.setDependencies(mockDb, trigger);
    });

    /**
     * Stop every schedule and drop the singleton so no state leaks between tests.
     */
    afterEach(() => {
        SchedulerService.resetInstance();
        mockDb.clear();
        vi.restoreAllMocks();
    });

    describe('runNow', () => {
        it('starts a registered job and invokes its handler', async () => {
            const handler = vi.fn(async () => {});
            const scheduler = SchedulerService.getInstance();
            scheduler.register('test:job', '* * * * *', handler);

            const result = await scheduler.runNow('test:job');
            await flush();

            expect(result).toEqual({ started: true });
            expect(handler).toHaveBeenCalledTimes(1);
        });

        it('throws for an unregistered job', async () => {
            const scheduler = SchedulerService.getInstance();
            await expect(scheduler.runNow('does:not-exist')).rejects.toThrow('not registered');
        });

        it('reports started:false when the job is already running (single-flight)', async () => {
            const { handler, release } = createGatedHandler();
            const scheduler = SchedulerService.getInstance();
            scheduler.register('test:slow', '* * * * *', handler);

            // First run parks inside the handler, holding the running lock.
            const first = await scheduler.runNow('test:slow');
            // Second run, while the first is still in flight, must not stack.
            const second = await scheduler.runNow('test:slow');

            expect(first).toEqual({ started: true });
            expect(second).toEqual({ started: false });
            expect(handler).toHaveBeenCalledTimes(1);

            release();
            await flush();
        });

        it('does not reject and releases the lock when the handler throws', async () => {
            const handler = vi.fn(async () => {
                throw new Error('boom');
            });
            const scheduler = SchedulerService.getInstance();
            scheduler.register('test:flaky', '* * * * *', handler);

            // never-throw: the rejection is recorded inside executeJob, not propagated.
            await expect(scheduler.runNow('test:flaky')).resolves.toEqual({ started: true });
            await flush();

            // Lock released despite the failure: a second run is accepted and re-invokes.
            const again = await scheduler.runNow('test:flaky');
            await flush();
            expect(again).toEqual({ started: true });
            expect(handler).toHaveBeenCalledTimes(2);
        });
    });

    describe('owner logger', () => {
        /**
         * Build a logger stand-in whose methods are spies, standing in for a
         * module's child logger so a test can see which logger an entry went to.
         *
         * @returns An object shaped like the logger the scheduler calls.
         */
        function createOwnerLogger(): { info: Mock; warn: Mock; error: Mock; debug: Mock } {
            return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
        }

        it('logs a job failure through the logger passed at registration', async () => {
            const ownerLogger = createOwnerLogger();
            const scheduler = SchedulerService.getInstance();
            scheduler.register('owner:flaky', '* * * * *', async () => {
                throw new Error('HTTP 401: Unauthorized');
            }, { logger: ownerLogger as never });

            await scheduler.runNow('owner:flaky');
            await flush();

            // The failure entry has to reach the owner's logger, because that is what
            // files it under the owner's service name and onto its Logs tab.
            expect(ownerLogger.error).toHaveBeenCalledWith(
                expect.objectContaining({ job: 'owner:flaky', status: 'failed', error: 'HTTP 401: Unauthorized' }),
                'Scheduled Job Failed: owner:flaky'
            );
        });

        it('logs a job success through the logger passed at registration', async () => {
            const ownerLogger = createOwnerLogger();
            const scheduler = SchedulerService.getInstance();
            scheduler.register('owner:ok', '* * * * *', async () => {}, { logger: ownerLogger as never });

            await scheduler.runNow('owner:ok');
            await flush();

            expect(ownerLogger.info).toHaveBeenCalledWith(
                expect.objectContaining({ job: 'owner:ok', status: 'success' }),
                'Scheduled Job Complete: owner:ok'
            );
        });
    });

    describe('scheduled slots', () => {
        it('schedules each enabled job through the injected trigger', async () => {
            const scheduler = SchedulerService.getInstance();
            scheduler.register('test:job', '*/15 * * * * *', vi.fn(async () => {}));

            await scheduler.start();

            expect(trigger.schedules).toHaveLength(1);
            expect(trigger.schedules[0].expression).toBe('*/15 * * * * *');
        });

        it('runs a scheduled time once even when the trigger reports it twice', async () => {
            const handler = vi.fn(async () => {});
            const scheduler = SchedulerService.getInstance();
            scheduler.register('test:job', '0 * * * *', handler);
            await scheduler.start();

            // The node-cron 3 failure: the same second delivered again, once on
            // time and once as a replay a second later.
            trigger.latest().onSlot(new Date('2026-09-18T02:30:00.000Z'));
            await flush();
            trigger.latest().onSlot(new Date('2026-09-18T02:30:00.280Z'));
            await flush();

            expect(handler).toHaveBeenCalledTimes(1);
        });

        it('runs each distinct scheduled time', async () => {
            const handler = vi.fn(async () => {});
            const scheduler = SchedulerService.getInstance();
            scheduler.register('test:job', '*/15 * * * * *', handler);
            await scheduler.start();

            trigger.latest().onSlot(new Date('2026-09-18T02:30:00.000Z'));
            await flush();
            trigger.latest().onSlot(new Date('2026-09-18T02:30:15.000Z'));
            await flush();

            expect(handler).toHaveBeenCalledTimes(2);
        });

        it('starts one catch-up run for a missed time when the job is idle', async () => {
            const handler = vi.fn(async () => {});
            const scheduler = SchedulerService.getInstance();
            scheduler.register('test:hourly', '0 * * * *', handler);
            await scheduler.start();

            trigger.latest().onMissed(new Date('2026-09-18T03:00:00.000Z'));
            await flush();

            expect(handler).toHaveBeenCalledTimes(1);
        });

        it('coalesces several missed times into a single catch-up run', async () => {
            const { handler, release } = createGatedHandler();
            const scheduler = SchedulerService.getInstance();
            scheduler.register('test:job', '*/15 * * * * *', handler);
            await scheduler.start();

            // A stall long enough to miss three slots of a 15-second job.
            trigger.latest().onMissed(new Date('2026-09-18T02:30:00.000Z'));
            trigger.latest().onMissed(new Date('2026-09-18T02:30:15.000Z'));
            trigger.latest().onMissed(new Date('2026-09-18T02:30:30.000Z'));
            await flush();

            expect(handler).toHaveBeenCalledTimes(1);

            release();
            await flush();
        });

        it('lets the on-time slot run when a wake-up reports missed and on-time slots together', async () => {
            const { handler, release } = createGatedHandler();
            const scheduler = SchedulerService.getInstance();
            scheduler.register('test:job', '*/15 * * * * *', handler);
            await scheduler.start();

            // node-cron reports the missed slot first, then the on-time slot from
            // the same wake-up. The missed one is deferred, then found covered.
            trigger.latest().onMissed(new Date('2026-09-18T02:30:00.000Z'));
            trigger.latest().onSlot(new Date('2026-09-18T02:30:15.000Z'));
            await flush();

            expect(handler).toHaveBeenCalledTimes(1);

            release();
            await flush();
        });

        it('does not start a catch-up run for a job unregistered before the missed time is handled', async () => {
            const handler = vi.fn(async () => {});
            const scheduler = SchedulerService.getInstance();
            scheduler.register('test:job', '0 * * * *', handler);
            await scheduler.start();

            const callbacks = trigger.latest();
            callbacks.onMissed(new Date('2026-09-18T03:00:00.000Z'));
            await scheduler.unregister('test:job');
            await flush();

            expect(handler).not.toHaveBeenCalled();
        });

        it('stops the trigger schedule when a job is unregistered', async () => {
            const scheduler = SchedulerService.getInstance();
            scheduler.register('test:job', '0 * * * *', vi.fn(async () => {}));
            await scheduler.start();

            await scheduler.unregister('test:job');

            expect(trigger.schedules[0].stopped).toBe(true);
        });
    });
});
