/**
 * @fileoverview Unit tests for SchedulerService.runNow and the shared executeJob
 * path it exercises.
 *
 * Why these exist: runNow is the on-demand trigger behind the dashboard "Run now"
 * button, and it shares one execution path with the cron tick (executeJob). The
 * contract that matters operationally is single-flight (a manual run never stacks
 * a second concurrent execution on top of an in-flight run) and never-throw (a
 * failing handler is recorded, not propagated, and always releases the running
 * lock so the job is not wedged into a permanently-skipped state). These tests pin
 * exactly that, using the shared in-memory database mock with a spied execution
 * model so no live MongoDB is required.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { SchedulerService } from '../services/scheduler.service.js';

/**
 * Drain pending micro/macro tasks so a fire-and-forget executeJob() reaches its
 * `finally` (lock release) before assertions run.
 *
 * @returns A promise that resolves after several event-loop turns.
 */
async function flush(): Promise<void> {
    for (let i = 0; i < 4; i += 1) {
        await new Promise((resolve) => setImmediate(resolve));
    }
}

describe('SchedulerService.runNow', () => {
    let mockDb: ReturnType<typeof createMockDatabaseService>;

    /**
     * Fresh singleton + a spied execution model before each test. The model's
     * create() returns a doc whose updateOne() is a no-op, matching what executeJob
     * needs to record start/finish without a real collection.
     */
    beforeEach(() => {
        SchedulerService.resetInstance();
        mockDb = createMockDatabaseService();
        vi.spyOn(mockDb, 'getModel').mockReturnValue({
            create: vi.fn(async (doc: unknown) => ({ ...(doc as object), updateOne: vi.fn(async () => {}) }))
        } as never);
        SchedulerService.setDependencies(mockDb);
    });

    afterEach(() => {
        SchedulerService.resetInstance();
        mockDb.clear();
        vi.restoreAllMocks();
    });

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
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const handler = vi.fn(async () => {
            await gate;
        });
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
