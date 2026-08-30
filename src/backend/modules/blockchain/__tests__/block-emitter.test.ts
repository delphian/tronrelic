/**
 * Unit tests for the backend playout buffer.
 *
 * The behaviour worth pinning is what the buffer does across a sequence, not
 * what any single call returns. Three sequences matter: it holds its first
 * blocks back to build a lead, it covers a gap in arrivals out of that lead
 * instead of passing the gap through to the feed, and it rebuilds the lead
 * afterwards. A buffer that fails the third test still looks correct in every
 * other way and only shows up as a feed that stutters on the second hiccup.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BlockEmitter, type IBlockNewPayload, type IPendingBlockEmit } from '../block-emitter.js';

/** Small thresholds so a test sequence stays readable. */
const THRESHOLDS = {
    intervalMs: 3_000,
    refillIntervalMs: 3_300,
    catchupIntervalMs: 2_000,
    targetDepth: 3,
    catchupDepth: 6,
    maxDepth: 10
};

const MAX_DEBT_BLOCKS = 3;

/**
 * How long to advance to take the emitter past its seeding window.
 *
 * One millisecond past the window rather than exactly on it, because ending the
 * seed schedules the first release as a fresh zero-delay timer and a fake-timer
 * tick that stops on the boundary does not pick that timer up. In production
 * the same hop is one turn of the event loop.
 */
const SEED_WINDOW_MS = THRESHOLDS.targetDepth * THRESHOLDS.intervalMs + 1;

/**
 * Build a `block:new` payload for a height, with the fields the emitter does
 * not read left minimal.
 *
 * The emitter treats the payload as opaque, so a test only needs the block
 * number to be identifiable in the released list.
 *
 * @param blockNumber - Height to stamp on the payload.
 * @returns A payload usable as buffer content.
 */
function buildPayload(blockNumber: number): IBlockNewPayload {
    return {
        blockNumber,
        timestamp: new Date(blockNumber * 3_000).toISOString(),
        receiptsFetched: false,
        stats: { transactions: 0 } as IBlockNewPayload['stats']
    };
}

/**
 * Build the buffer entry for a height.
 *
 * @param blockNumber - Height to enqueue.
 * @returns The pending entry the emitter accepts.
 */
function pending(blockNumber: number): IPendingBlockEmit {
    return { blockNumber, payload: buildPayload(blockNumber) };
}

/**
 * Create an emitter wired to a recording release function.
 *
 * Returned together because every test asserts on what was released and when,
 * and building the pair in one place keeps each test to the sequence it is
 * actually about.
 *
 * @param targetDepth - Lead to hold, overridden by the tests that exercise the
 *                      switched-off and deeper-buffer cases.
 * @returns The emitter and the list of block numbers released so far, in order.
 */
function createEmitter(targetDepth = THRESHOLDS.targetDepth) {
    const released: number[] = [];
    const emitter = new BlockEmitter(
        payload => released.push(payload.blockNumber),
        { ...THRESHOLDS, targetDepth },
        MAX_DEBT_BLOCKS
    );

    return { emitter, released };
}

describe('BlockEmitter', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('holds its first blocks back until the lead is built', () => {
        // Without this hold the buffer keeps nothing: every arrival finds the
        // previous release already due, waits zero, and goes straight out, so
        // the very first upstream gap reaches the screen.
        const { emitter, released } = createEmitter();

        emitter.enqueue(pending(100));
        emitter.enqueue(pending(101));
        vi.advanceTimersByTime(1_000);

        expect(released).toEqual([]);
        expect(emitter.getMetrics().seeded).toBe(false);
        expect(emitter.getMetrics().depth).toBe(2);
    });

    it('starts releasing as soon as the lead reaches target', () => {
        const { emitter, released } = createEmitter();

        emitter.enqueue(pending(100));
        emitter.enqueue(pending(101));
        emitter.enqueue(pending(102));
        vi.advanceTimersByTime(0);

        expect(released).toEqual([100]);
        expect(emitter.getMetrics().seeded).toBe(true);
    });

    it('starts releasing on time even when the lead never arrives', () => {
        // A stalled chain must not leave the feed holding its first block.
        const { emitter, released } = createEmitter();

        emitter.enqueue(pending(100));
        vi.advanceTimersByTime(SEED_WINDOW_MS);

        expect(released).toEqual([100]);
    });

    it('releases in block order when a retry lands out of order', () => {
        const { emitter, released } = createEmitter();

        emitter.enqueue(pending(100));
        emitter.enqueue(pending(102));
        emitter.enqueue(pending(101));
        vi.advanceTimersByTime(20_000);

        expect(released).toEqual([100, 101, 102]);
    });

    it('covers a gap in arrivals out of its lead instead of passing it on', () => {
        // The whole point of the buffer. Blocks arrive, then one slot is
        // missed entirely, and the feed must keep releasing across the hole.
        const { emitter, released } = createEmitter();

        emitter.enqueue(pending(100));
        emitter.enqueue(pending(101));
        emitter.enqueue(pending(102));
        vi.advanceTimersByTime(0);
        expect(released).toEqual([100]);

        // Nothing arrives for two block times — the upstream hiccup.
        vi.advanceTimersByTime(6_600);

        // The feed still advanced, drawing on the lead rather than stalling.
        expect(released).toEqual([100, 101, 102]);
    });

    it('rebuilds the lead after a drain by releasing slower than blocks arrive', () => {
        // The property the frontend playout buffer lacks. After the buffer has
        // been emptied, arrivals at the chain rate must push depth back up
        // rather than passing straight through at zero depth forever.
        const { emitter, released } = createEmitter();

        emitter.enqueue(pending(100));
        vi.advanceTimersByTime(SEED_WINDOW_MS);
        expect(released).toEqual([100]);
        expect(emitter.getMetrics().depth).toBe(0);

        // Forty blocks arriving at exactly the chain's own rate. Releasing at
        // the refill interval is slower than that, so the surplus accumulates
        // as depth until the lead is back at target.
        for (let index = 1; index <= 40; index += 1) {
            emitter.enqueue(pending(100 + index));
            vi.advanceTimersByTime(THRESHOLDS.intervalMs);
        }

        expect(emitter.getMetrics().depth).toBeGreaterThanOrEqual(THRESHOLDS.targetDepth - 1);
        expect(released.length).toBeLessThan(41);
    });

    it('counts every drain to empty, since that is when the feed is exposed', () => {
        const { emitter } = createEmitter();

        emitter.enqueue(pending(100));
        vi.advanceTimersByTime(SEED_WINDOW_MS);

        expect(emitter.getMetrics().underruns).toBe(1);
        expect(emitter.getMetrics().depth).toBe(0);
    });

    it('drains without waiting once depth passes the point where latency hurts more', () => {
        const { emitter, released } = createEmitter();

        for (let index = 0; index < THRESHOLDS.maxDepth + 2; index += 1) {
            emitter.enqueue(pending(100 + index));
        }

        // A few milliseconds, not zero: each release above the cap schedules
        // the next as a fresh zero-delay timer, and a fake-timer tick will not
        // follow that chain unless the window it is given extends past them.
        vi.advanceTimersByTime(5);

        // Back-to-back releases bring depth under the cap without any block
        // time passing.
        expect(released.length).toBeGreaterThan(1);
        expect(emitter.getMetrics().depth).toBeLessThan(THRESHOLDS.maxDepth);
    });

    it('flushes what it holds before broadcasting a catch-up block', () => {
        // A catch-up block is newer than everything buffered, so releasing it
        // first would show the height jump forward and then fall back.
        const { emitter, released } = createEmitter();

        emitter.enqueue(pending(100));
        emitter.enqueue(pending(101));
        emitter.emitNow(pending(102));

        expect(released).toEqual([100, 101, 102]);
        expect(emitter.getMetrics().depth).toBe(0);
        expect(emitter.getMetrics().flushes).toBe(1);
    });

    it('does not re-seed after a catch-up run', () => {
        // Re-seeding would stall the feed for a full lead every time the syncer
        // recovered — exactly when a viewer is already waiting. The lead is
        // rebuilt by the slower refill interval instead.
        const { emitter, released } = createEmitter();

        emitter.enqueue(pending(100));
        emitter.enqueue(pending(101));
        emitter.enqueue(pending(102));
        vi.advanceTimersByTime(0);
        emitter.emitNow(pending(200));
        released.length = 0;

        emitter.enqueue(pending(201));
        vi.advanceTimersByTime(0);

        expect(released).toEqual([201]);
    });

    it('releases immediately at every depth when buffering is switched off', () => {
        // Target depth zero is the behaviour-preserving setting for a staged
        // rollout, so it must never hold anything back.
        const { emitter, released } = createEmitter(0);

        emitter.enqueue(pending(100));
        vi.advanceTimersByTime(0);

        expect(released).toEqual([100]);
    });

    it('keeps the clock running when a release throws', () => {
        // An error escaping a timer callback would kill the release clock and
        // freeze the feed with no obvious cause. Losing one broadcast is
        // recoverable; losing the clock is not.
        const released: number[] = [];
        const emitter = new BlockEmitter(
            payload => {
                if (payload.blockNumber === 101) {
                    throw new Error('socket gone');
                }
                released.push(payload.blockNumber);
            },
            { ...THRESHOLDS, targetDepth: 1 },
            MAX_DEBT_BLOCKS
        );

        emitter.enqueue(pending(100));
        emitter.enqueue(pending(101));
        emitter.enqueue(pending(102));
        vi.advanceTimersByTime(20_000);

        expect(released).toEqual([100, 102]);
    });

    it('releases everything it holds on shutdown', () => {
        // Those blocks are already fetched and written, so dropping them would
        // silently deny connected clients data the backend already has.
        const { emitter, released } = createEmitter();

        emitter.enqueue(pending(100));
        emitter.enqueue(pending(101));
        emitter.stop();

        expect(released).toEqual([100, 101]);
    });

    describe('applyThresholds', () => {
        it('takes effect during the wait it interrupts, not after it', () => {
            // The reason the pending timer is cancelled. An operator who saves a
            // change and watches nothing happen for the remainder of a 3.3
            // second wait reasonably concludes the save failed, and the whole
            // point of moving these settings out of the environment was to make
            // the effect observable straight away.
            const { emitter, released } = createEmitter();

            emitter.enqueue(pending(100));
            emitter.enqueue(pending(101));
            emitter.enqueue(pending(102));
            vi.advanceTimersByTime(0);
            expect(released).toEqual([100]);

            // Part-way through the next wait, switch to releasing with no delay.
            vi.advanceTimersByTime(500);
            emitter.applyThresholds({ ...THRESHOLDS, targetDepth: 0, catchupDepth: 1, maxDepth: 2 });
            vi.advanceTimersByTime(5);

            expect(released).toEqual([100, 101, 102]);
        });

        it('drains the surplus when the lead is lowered', () => {
            // Blocks held under the old target are now above the new catch-up
            // depth, so the existing release logic spends them at the faster
            // interval. Nothing needs to flush them by hand.
            const { emitter, released } = createEmitter();

            for (let index = 0; index < 6; index += 1) {
                emitter.enqueue(pending(100 + index));
            }
            vi.advanceTimersByTime(0);
            released.length = 0;

            emitter.applyThresholds({ ...THRESHOLDS, targetDepth: 1, catchupDepth: 2, maxDepth: 3 });
            vi.advanceTimersByTime(THRESHOLDS.catchupIntervalMs * 4);

            expect(emitter.getMetrics().depth).toBeLessThanOrEqual(1);
            expect(released.length).toBeGreaterThan(1);
        });

        it('rebuilds toward a raised lead instead of stalling to re-seed', () => {
            // Raising the target must not stop the feed while a bigger lead is
            // collected. Seeding is a once-per-process cost, and paying it again
            // on every save would freeze the feed for the new lead's worth of
            // time in front of whoever is watching.
            const { emitter, released } = createEmitter();

            emitter.enqueue(pending(100));
            emitter.enqueue(pending(101));
            emitter.enqueue(pending(102));
            vi.advanceTimersByTime(0);
            expect(emitter.getMetrics().seeded).toBe(true);
            released.length = 0;

            emitter.applyThresholds({ ...THRESHOLDS, targetDepth: 8, catchupDepth: 13, maxDepth: 40 });

            for (let index = 3; index < 12; index += 1) {
                emitter.enqueue(pending(100 + index));
                vi.advanceTimersByTime(THRESHOLDS.intervalMs);
            }

            expect(emitter.getMetrics().seeded).toBe(true);
            expect(released.length).toBeGreaterThan(0);
            expect(emitter.getMetrics().depth).toBeGreaterThan(THRESHOLDS.targetDepth);
        });

        it('reports the new target to the console it is judged from', () => {
            // The Blockchain tab reads the target off these metrics rather than
            // from configuration, so a stale value here would have an operator
            // comparing live depth against a lead the emitter is no longer
            // holding.
            const { emitter } = createEmitter();

            emitter.applyThresholds({ ...THRESHOLDS, targetDepth: 12, catchupDepth: 20, maxDepth: 50 });

            expect(emitter.getMetrics().targetDepth).toBe(12);
        });
    });
});
