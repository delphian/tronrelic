/**
 * @file syndication-service.test.ts
 *
 * Exercises the durable delivery engine end-to-end against the in-memory mock
 * database: idempotent enqueue, the relay's claim-and-deliver, the refusal vs
 * failure split, retry-with-backoff progressing to dead-letter, crash-orphan
 * reclaim, operator requeue, and the read projections. These are the invariants
 * the content-routing design promises ("at-least-once plus idempotency"), so they
 * are tested as behaviour, not implementation detail.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IContentRouter, IContentSink, IHookRegistry, ISystemLogService } from '@/types';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { SyndicationService } from '../services/syndication-service.js';
import { SYNDICATION_OUTBOX_COLLECTION } from '../database/ISyndicationOutboxDocument.js';

/**
 * A no-op logger satisfying the methods the service calls, so tests run without
 * the real logging system.
 *
 * @returns A logger stub.
 */
function makeLogger(): ISystemLogService {
    const stub = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    return { ...stub, child: () => stub } as unknown as ISystemLogService;
}

/**
 * A content router stub exposing only `getSinks()` — the sole router method the
 * relay calls. The sink list is mutable so a test can simulate a sink being
 * absent (a disabled plugin).
 *
 * @param sinks - The sinks the relay will resolve from.
 * @returns A router stub plus a setter for the live sink list.
 */
function makeRouter(sinks: IContentSink[]): { router: IContentRouter; setSinks: (s: IContentSink[]) => void } {
    let live = sinks;
    const router = { getSinks: () => live } as unknown as IContentRouter;
    return { router, setSinks: (s) => { live = s; } };
}

/**
 * Build a publish sink whose `deliver` behaviour is supplied by the test.
 *
 * @param id - Sink id.
 * @param deliver - The deliver implementation.
 * @returns The sink.
 */
function makeSink(id: string, deliver: IContentSink['deliver']): IContentSink {
    return { id, kind: 'publish', accepts: ['body'], reach: { egress: 'external', audience: 'public' }, deliver };
}

/**
 * A hook-registry stub exposing only `invoke` — the sole registry method the
 * relay calls (to fire `scheduler.legDelivered` on success). Returned as a
 * `vi.fn` so a test can assert the delivered-hook fired with its payload.
 *
 * @returns A hook-registry stub.
 */
function makeHookRegistry(): IHookRegistry {
    return { invoke: vi.fn().mockResolvedValue(undefined) } as unknown as IHookRegistry;
}

describe('SyndicationService', () => {
    let db: ReturnType<typeof createMockDatabaseService>;

    beforeEach(() => {
        db = createMockDatabaseService();
    });

    describe('enqueue', () => {
        it('creates one pending leg per destination with a deterministic idempotency key', async () => {
            const { router } = makeRouter([]);
            const service = new SyndicationService(makeLogger(), db, router, makeHookRegistry());

            const result = await service.enqueue({
                originId: 'item-1',
                originKind: 'curation',
                typeId: 'blog',
                ref: { postId: 'p1' },
                descriptor: { body: 'hello' },
                legs: [{ sinkId: 'core:internal-publish' }, { sinkId: 'telegram-bot:channel-42', dest: { chatId: 42 } }]
            });

            expect(result.enqueued).toBe(2);
            const rows = db.getCollectionData(SYNDICATION_OUTBOX_COLLECTION);
            expect(rows).toHaveLength(2);
            expect(rows.every((r) => r.status === 'pending' && r.attempts === 0)).toBe(true);
            expect(rows.map((r) => r.idempotencyKey)).toEqual([
                'item-1::core:internal-publish',
                'item-1::telegram-bot:channel-42'
            ]);
        });

        it('is idempotent on a duplicate-key collision — no second row, existing id returned', async () => {
            const { router } = makeRouter([]);
            const service = new SyndicationService(makeLogger(), db, router, makeHookRegistry());

            const first = await service.enqueue({
                originId: 'item-1', originKind: 'curation', typeId: 'blog', ref: { postId: 'p1' }, descriptor: { body: 'x' }, legs: [{ sinkId: 'sink-a' }]
            });

            // Simulate the unique index rejecting the re-insert.
            db.injectError(SYNDICATION_OUTBOX_COLLECTION, 'insertOne', Object.assign(new Error('dup'), { code: 11000 }));
            const second = await service.enqueue({
                originId: 'item-1', originKind: 'curation', typeId: 'blog', ref: { postId: 'p1' }, descriptor: { body: 'x' }, legs: [{ sinkId: 'sink-a' }]
            });

            expect(db.getCollectionData(SYNDICATION_OUTBOX_COLLECTION)).toHaveLength(1);
            expect(second.legIds).toEqual(first.legIds);
        });
    });

    describe('runRelayOnce — delivery', () => {
        it('delivers a pending leg and marks it delivered, passing the idempotency key and attempt', async () => {
            const deliver = vi.fn().mockResolvedValue(undefined);
            const { router } = makeRouter([makeSink('sink-a', deliver)]);
            const service = new SyndicationService(makeLogger(), db, router, makeHookRegistry());
            await service.enqueue({ originId: 'o1', originKind: 'curation', typeId: 'blog', ref: { postId: 'p1' }, descriptor: { body: 'hi' }, legs: [{ sinkId: 'sink-a', dest: { k: 1 } }] });

            const attempted = await service.runRelayOnce();

            expect(attempted).toBe(1);
            expect(deliver).toHaveBeenCalledWith({ body: 'hi' }, { k: 1 }, { idempotencyKey: 'o1::sink-a', attempt: 1 });
            const [row] = await service.getLegs('o1');
            expect(row.status).toBe('delivered');
            expect(row.attempts).toBe(1);
        });

        it('fires scheduler.legDelivered on success with the sink, descriptor, and provider coordinates', async () => {
            const deliver = vi.fn().mockResolvedValue(undefined);
            const { router } = makeRouter([makeSink('sink-a', deliver)]);
            const hooks = makeHookRegistry();
            const service = new SyndicationService(makeLogger(), db, router, hooks);
            await service.enqueue({ originId: 'o1', originKind: 'curation', typeId: 'blog', ref: { postId: 'p1' }, descriptor: { body: 'hi' }, legs: [{ sinkId: 'sink-a' }] });

            await service.runRelayOnce();

            expect(hooks.invoke).toHaveBeenCalledTimes(1);
            const [descriptor, payload] = (hooks.invoke as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
            expect(descriptor.id).toBe('scheduler.legDelivered');
            expect(payload).toMatchObject({
                sinkId: 'sink-a',
                typeId: 'blog',
                ref: { postId: 'p1' },
                descriptor: { body: 'hi' },
                originId: 'o1',
                originKind: 'curation',
                idempotencyKey: 'o1::sink-a',
                attempt: 1
            });
        });

        it('records a sink refusal as refused (terminal), carrying the reason verbatim, and does not fire the delivered hook', async () => {
            const deliver = vi.fn().mockResolvedValue({ refused: true, reason: 'not for telegram' });
            const { router } = makeRouter([makeSink('sink-a', deliver)]);
            const hooks = makeHookRegistry();
            const service = new SyndicationService(makeLogger(), db, router, hooks);
            await service.enqueue({ originId: 'o1', originKind: 'curation', typeId: 'blog', ref: { postId: 'p1' }, descriptor: { body: 'hi' }, legs: [{ sinkId: 'sink-a' }] });

            await service.runRelayOnce();

            const [row] = await service.getLegs('o1');
            expect(row.status).toBe('refused');
            expect(row.reason).toBe('not for telegram');
            expect(hooks.invoke).not.toHaveBeenCalled();
        });

        it('treats an unregistered sink as a retryable failure, not a terminal one', async () => {
            const { router } = makeRouter([]); // no sink registered
            const service = new SyndicationService(makeLogger(), db, router, makeHookRegistry(), { maxAttempts: 3 });
            await service.enqueue({ originId: 'o1', originKind: 'curation', typeId: 'blog', ref: { postId: 'p1' }, descriptor: { body: 'hi' }, legs: [{ sinkId: 'absent' }] });

            await service.runRelayOnce();

            const [row] = await service.getLegs('o1');
            expect(row.status).toBe('failed');
            expect(row.lastError).toContain('not registered');
        });
    });

    describe('runRelayOnce — retry and dead-letter', () => {
        it('retries a failing leg with backoff and dead-letters it once the budget is exhausted', async () => {
            const deliver = vi.fn().mockRejectedValue(new Error('boom'));
            const { router } = makeRouter([makeSink('sink-a', deliver)]);
            const service = new SyndicationService(makeLogger(), db, router, makeHookRegistry(), { maxAttempts: 3 });
            await service.enqueue({ originId: 'o1', originKind: 'curation', typeId: 'blog', ref: { postId: 'p1' }, descriptor: { body: 'hi' }, legs: [{ sinkId: 'sink-a' }] });

            // Attempt 1 fails → failed with a future nextAttemptAt.
            await service.runRelayOnce();
            let [row] = await service.getLegs('o1');
            expect(row.status).toBe('failed');
            expect(row.attempts).toBe(1);

            // The backed-off leg is not yet due, so the next tick skips it.
            expect(await service.runRelayOnce()).toBe(0);

            // Make it due (simulating elapsed backoff) and run again → attempt 2.
            makeDue(db);
            await service.runRelayOnce();
            [row] = await service.getLegs('o1');
            expect(row.attempts).toBe(2);
            expect(row.status).toBe('failed');

            // Attempt 3 exhausts the budget → dead-lettered.
            makeDue(db);
            await service.runRelayOnce();
            [row] = await service.getLegs('o1');
            expect(row.status).toBe('dead');
            expect(row.attempts).toBe(3);
            expect(deliver).toHaveBeenCalledTimes(3);
        });
    });

    describe('runRelayOnce — crash-orphan reclaim', () => {
        it('reclaims a leg stuck in delivering and delivers it', async () => {
            const deliver = vi.fn().mockResolvedValue(undefined);
            const { router } = makeRouter([makeSink('sink-a', deliver)]);
            const service = new SyndicationService(makeLogger(), db, router, makeHookRegistry(), { claimStaleMs: 1000 });
            await service.enqueue({ originId: 'o1', originKind: 'curation', typeId: 'blog', ref: { postId: 'p1' }, descriptor: { body: 'hi' }, legs: [{ sinkId: 'sink-a' }] });

            // Simulate a crash mid-delivery: status delivering, updatedAt long past.
            const rows = db.getCollectionData(SYNDICATION_OUTBOX_COLLECTION);
            rows[0].status = 'delivering';
            rows[0].updatedAt = new Date(Date.now() - 60_000);

            await service.runRelayOnce();

            const [row] = await service.getLegs('o1');
            expect(row.status).toBe('delivered');
            expect(deliver).toHaveBeenCalledTimes(1);
        });
    });

    describe('runRelayOnce — stale-claim settle guard', () => {
        it('a settle carrying a stale claim token does not overwrite a re-claimed leg', async () => {
            // Reproduce the lost-update window: while the original (slow) worker is
            // inside deliver(), the leg is reclaimed as stale and re-claimed by a
            // later tick, which advances `attempts` and mints a fresh claim token.
            // The slow worker's terminal settle must be a no-op — guarded on its now
            // stale token — leaving the re-claimed active attempt untouched. Under a
            // `{ _id }`-only settle this would clobber the row to `delivered`.
            const deliver = vi.fn().mockImplementation(async () => {
                const [row] = db.getCollectionData(SYNDICATION_OUTBOX_COLLECTION);
                row.status = 'delivering';
                row.claimToken = 'tok-new-attempt';
                row.attempts = 5;
                row.updatedAt = new Date();
                return undefined;
            });
            const { router } = makeRouter([makeSink('sink-a', deliver)]);
            const hooks = makeHookRegistry();
            const service = new SyndicationService(makeLogger(), db, router, hooks);
            await service.enqueue({ originId: 'o1', originKind: 'curation', typeId: 'blog', ref: { postId: 'p1' }, descriptor: { body: 'hi' }, legs: [{ sinkId: 'sink-a' }] });

            await service.runRelayOnce();

            const [row] = await service.getLegs('o1');
            // The original worker's 'delivered' settle was filtered out by the stale
            // token, so the re-claimed attempt's state survives intact.
            expect(row.status).toBe('delivering');
            expect(row.attempts).toBe(5);
            expect(row.idempotencyKey).toBe('o1::sink-a');
            // And because that settle was a CAS no-op, the losing attempt must not
            // have fired the delivered hook — the winning tick will.
            expect(hooks.invoke).not.toHaveBeenCalled();
        });
    });

    describe('operator surface', () => {
        it('retry() requeues a dead-lettered leg and is a no-op for a live one', async () => {
            const deliver = vi.fn().mockRejectedValue(new Error('boom'));
            const { router } = makeRouter([makeSink('sink-a', deliver)]);
            const service = new SyndicationService(makeLogger(), db, router, makeHookRegistry(), { maxAttempts: 1 });
            const { legIds } = await service.enqueue({ originId: 'o1', originKind: 'curation', typeId: 'blog', ref: { postId: 'p1' }, descriptor: { body: 'hi' }, legs: [{ sinkId: 'sink-a' }] });
            await service.runRelayOnce(); // maxAttempts 1 → dead immediately

            expect((await service.getLegs('o1'))[0].status).toBe('dead');
            expect(await service.retry(legIds[0])).toBe(true);

            const [row] = await service.getLegs('o1');
            expect(row.status).toBe('pending');
            expect(row.attempts).toBe(0);
            expect(await service.retry(legIds[0])).toBe(false); // now pending, not dead
        });

        it('getStats counts legs by status and getLegsForOrigins groups by origin', async () => {
            const { router } = makeRouter([]);
            const service = new SyndicationService(makeLogger(), db, router, makeHookRegistry());
            await service.enqueue({ originId: 'o1', originKind: 'curation', typeId: 'blog', ref: { postId: 'p1' }, descriptor: { body: 'a' }, legs: [{ sinkId: 's1' }, { sinkId: 's2' }] });
            await service.enqueue({ originId: 'o2', originKind: 'curation', typeId: 'blog', ref: { postId: 'p1' }, descriptor: { body: 'b' }, legs: [{ sinkId: 's1' }] });

            expect((await service.getStats()).pending).toBe(3);
            const grouped = await service.getLegsForOrigins(['o1', 'o2', 'absent']);
            expect(grouped.o1).toHaveLength(2);
            expect(grouped.o2).toHaveLength(1);
            expect(grouped.absent).toBeUndefined();
        });
    });
});

/**
 * Force every backed-off `failed` leg due now, simulating elapsed backoff without
 * fake timers — the relay's due check is `nextAttemptAt <= now`.
 *
 * @param db - The mock database whose outbox rows to age.
 */
function makeDue(db: ReturnType<typeof createMockDatabaseService>): void {
    for (const row of db.getCollectionData(SYNDICATION_OUTBOX_COLLECTION)) {
        if (row.status === 'failed') {
            row.nextAttemptAt = new Date(Date.now() - 1000);
        }
    }
}
