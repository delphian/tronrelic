/**
 * @fileoverview Tests for the minimum-interval pacer.
 *
 * The pacer exists to stop one request draining a shared provider queue, so the
 * property under test is a timing one: when does a caller actually get its
 * result back. Timing assertions against a real clock are flaky on a loaded CI
 * machine, so every case below runs on Vitest's fake timers, where the clock
 * only moves when the test moves it and the expected millisecond is exact.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { CallPacer } from '../lib/CallPacer.js';

/** Slot length used throughout, matching the production interval. */
const INTERVAL_MS = 2000;

/**
 * Record when each of several sequential paced calls resolves, relative to the
 * start, why: the pacer's whole contract is the spacing between those moments,
 * and reading it off a list of offsets makes an off-by-one-slot regression
 * obvious in the assertion itself.
 *
 * @param pacer - Pacer under test, already constructed with its interval.
 * @param callCount - How many calls to make back to back.
 * @param work - The work each call runs; defaults to something instant, so the
 *   offsets show the pacing alone.
 * @returns Millisecond offsets at which each call resolved.
 */
async function offsetsOf(
    pacer: CallPacer,
    callCount: number,
    work: () => Promise<unknown> = async () => 'done'
): Promise<number[]> {
    const startedAt = Date.now();
    const offsets: number[] = [];

    const sequence = (async () => {
        for (let index = 0; index < callCount; index += 1) {
            await pacer.run(work);
            offsets.push(Date.now() - startedAt);
        }
    })();

    // Generously past the last expected slot: the clock only advances here, so
    // an over-long window cannot mask a missing wait, it only lets the sequence
    // finish.
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * (callCount + 2));
    await sequence;
    return offsets;
}

afterEach(() => {
    vi.useRealTimers();
});

describe('CallPacer', () => {
    it('spaces consecutive calls by the interval', async () => {
        vi.useFakeTimers();
        const offsets = await offsetsOf(new CallPacer(INTERVAL_MS), 3);
        expect(offsets).toEqual([2000, 4000, 6000]);
    });

    it('measures the interval from when the work starts, not when it ends', async () => {
        vi.useFakeTimers();
        // A step that takes a quarter of its slot still resolves on the slot
        // boundary, which is what keeps arrivals evenly spaced for a consumer
        // watching them stream in.
        const offsets = await offsetsOf(
            new CallPacer(INTERVAL_MS),
            2,
            () => new Promise(resolve => setTimeout(resolve, 500))
        );
        expect(offsets).toEqual([2000, 4000]);
    });

    it('does not delay work that already outran its own interval', async () => {
        vi.useFakeTimers();
        // Padding a slow step would punish it twice — once by the provider queue
        // it waited on, once by us.
        const offsets = await offsetsOf(
            new CallPacer(INTERVAL_MS),
            2,
            () => new Promise(resolve => setTimeout(resolve, 3000))
        );
        expect(offsets).toEqual([3000, 6000]);
    });

    it('returns immediately when the caller declines pacing for that call', async () => {
        vi.useFakeTimers();
        const pacer = new CallPacer(INTERVAL_MS);
        const startedAt = Date.now();

        const call = pacer.run(async () => 'first', { shouldPace: () => false });
        await vi.advanceTimersByTimeAsync(0);

        await expect(call).resolves.toBe('first');
        expect(Date.now() - startedAt).toBe(0);
    });

    it('decides pacing from the result, so an outcome can opt itself out', async () => {
        vi.useFakeTimers();
        const pacer = new CallPacer(INTERVAL_MS);
        const startedAt = Date.now();
        const offsets: number[] = [];

        const sequence = (async () => {
            for (const value of ['pace-me', 'skip-me']) {
                await pacer.run(async () => value, { shouldPace: result => result === 'pace-me' });
                offsets.push(Date.now() - startedAt);
            }
        })();

        await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);
        await sequence;
        expect(offsets).toEqual([2000, 2000]);
    });

    it('stops waiting when the run is aborted, and hands back the result it already had', async () => {
        vi.useFakeTimers();
        const controller = new AbortController();
        const pacer = new CallPacer(INTERVAL_MS, controller.signal);
        const startedAt = Date.now();

        const call = pacer.run(async () => 'partial');
        await vi.advanceTimersByTimeAsync(500);
        controller.abort();
        await vi.advanceTimersByTimeAsync(0);

        // Resolving rather than throwing is deliberate: the caller that owns the
        // signal already knows the run is over and decides what that means.
        await expect(call).resolves.toBe('partial');
        expect(Date.now() - startedAt).toBe(500);
    });

    it('keeps serving later calls after one of them fails', async () => {
        vi.useFakeTimers();
        const pacer = new CallPacer(INTERVAL_MS);

        // A rejected call must not leave the internal chain permanently
        // rejected, or one provider error would wedge every remaining ladder.
        // The failure is captured as a value rather than left as a floating
        // rejected promise, which would be reported as unhandled before the
        // assertion below gets to it.
        const failing = pacer
            .run(async () => {
                throw new Error('provider exploded');
            })
            .catch((error: Error) => error.message);
        const following = pacer.run(async () => 'recovered');

        await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);
        await expect(failing).resolves.toBe('provider exploded');
        await expect(following).resolves.toBe('recovered');
    });
});
