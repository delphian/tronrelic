/**
 * Unit tests for the block broadcast pacer. The property that matters is that
 * pacing debt carries forward: a slow block must shorten the next wait rather
 * than push its overrun into permanent lag, because permanent lag is what
 * builds up until the syncer abandons pacing and dumps a burst. That property
 * is invisible in any single call and only shows up across a sequence, so the
 * sequence tests below are the ones that would catch a regression.
 */
import { describe, it, expect } from 'vitest';
import { resolveEmitPacing, resolveBlockAgeInBlocks } from '../block-pacer.js';

/** Production defaults: three-second blocks, three blocks of debt allowed. */
const INTERVAL_MS = 3_000;
const MAX_DEBT_BLOCKS = 3;

/**
 * Run a sequence of blocks through the pacer and report the wall-clock time of
 * each broadcast, which is the thing a viewer actually experiences.
 *
 * Written as a helper because the drift bug this pacer replaced is only visible
 * across several blocks in a row — a single call looks correct either way.
 *
 * @param processingTimes - How long each block takes to reach the broadcast
 *                          point, in milliseconds, in order.
 * @param startAt - The wall-clock time the first block starts processing.
 * @returns The broadcast time of each block, so a test can assert on the gaps
 *          between them rather than on the pacer's internal bookkeeping.
 */
function simulateEmits(processingTimes: number[], startAt = 1_000_000): number[] {
    let clock = startAt;
    let nextEmitAt = 0;
    const emitTimes: number[] = [];

    for (const processingMs of processingTimes) {
        clock += processingMs;
        const pacing = resolveEmitPacing({
            now: clock,
            nextEmitAt,
            intervalMs: INTERVAL_MS,
            maxDebtBlocks: MAX_DEBT_BLOCKS
        });
        clock += pacing.delayMs;
        nextEmitAt = pacing.nextEmitAt;
        emitTimes.push(clock);
    }

    return emitTimes;
}

/**
 * Convert broadcast times into the gaps between them, which is what a viewer
 * perceives as the block cadence.
 *
 * @param emitTimes - Broadcast times in order.
 * @returns The interval preceding each broadcast after the first.
 */
function gapsBetween(emitTimes: number[]): number[] {
    return emitTimes.slice(1).map((time, index) => time - emitTimes[index]);
}

describe('resolveEmitPacing', () => {
    it('starts the cadence immediately on the first block', () => {
        // A zero carried deadline is "not started", not "hugely overdue".
        const pacing = resolveEmitPacing({
            now: 1_000_000,
            nextEmitAt: 0,
            intervalMs: INTERVAL_MS,
            maxDebtBlocks: MAX_DEBT_BLOCKS
        });

        expect(pacing.delayMs).toBe(0);
        expect(pacing.nextEmitAt).toBe(1_003_000);
    });

    it('waits out the remainder when a block finishes early', () => {
        const pacing = resolveEmitPacing({
            now: 1_001_000,
            nextEmitAt: 1_003_000,
            intervalMs: INTERVAL_MS,
            maxDebtBlocks: MAX_DEBT_BLOCKS
        });

        expect(pacing.delayMs).toBe(2_000);
        expect(pacing.nextEmitAt).toBe(1_006_000);
    });

    it('repays a slow block by shortening the next wait', () => {
        // Block ran 1s past its deadline: broadcast now, and leave the next
        // deadline where it always was so the debt is worked off rather than
        // carried forever.
        const pacing = resolveEmitPacing({
            now: 1_004_000,
            nextEmitAt: 1_003_000,
            intervalMs: INTERVAL_MS,
            maxDebtBlocks: MAX_DEBT_BLOCKS
        });

        expect(pacing.delayMs).toBe(0);
        expect(pacing.nextEmitAt).toBe(1_006_000);
    });

    it('caps how far into the past the deadline may lag', () => {
        // A five-minute stall must not bank five minutes of catch-up.
        const pacing = resolveEmitPacing({
            now: 1_300_000,
            nextEmitAt: 1_003_000,
            intervalMs: INTERVAL_MS,
            maxDebtBlocks: MAX_DEBT_BLOCKS
        });

        expect(pacing.delayMs).toBe(0);
        // Floored at now - 3 blocks, then advanced one interval.
        expect(pacing.nextEmitAt).toBe(1_300_000 - 9_000 + 3_000);
    });

    it('absorbs a single slow block instead of carrying its overrun forward', () => {
        // The regression this module exists to prevent. One block overruns by
        // 1.2s, so its own gap is genuinely long — the pacer cannot invent
        // time. What it must do is shorten the following gap by the same
        // amount, leaving the total across the run at an exact multiple of the
        // interval. A per-block stopwatch instead gives the next block a fresh
        // full interval, and that 1.2s becomes lag the syncer never gets back.
        const emits = simulateEmits([500, 400, 4_200, 300, 600]);
        const gaps = gapsBetween(emits);

        expect(gaps).toEqual([3_000, 4_200, 1_800, 3_000]);
        expect(emits[emits.length - 1] - emits[0]).toBe(4 * INTERVAL_MS);
    });

    it('does not drift when every block runs slightly slow', () => {
        // Nine blocks at 3.2s each. The old pacer emitted these 200ms apart
        // from the target every time, losing nearly two seconds over the run.
        const emits = simulateEmits(Array(9).fill(3_200));
        const gaps = gapsBetween(emits);
        const total = emits[emits.length - 1] - emits[0];

        expect(gaps.every(gap => gap === 3_200)).toBe(true);
        // Processing genuinely exceeds the interval here, so the pacer cannot
        // invent time — but it adds none of its own on top.
        expect(total).toBe(8 * 3_200);
    });

    it('recovers from a stall with a bounded burst, then resumes cadence', () => {
        // One 60-second block, then normal work. Only the debt cap's worth of
        // blocks may catch up back-to-back.
        const gaps = gapsBetween(simulateEmits([500, 60_000, 500, 500, 500, 500, 500]));

        expect(gaps[0]).toBe(60_000);
        // Exactly the debt cap's worth of blocks release at processing speed.
        expect(gaps.slice(1, 4)).toEqual([500, 500, 500]);
        // The debt runs out partway through the next block's wait.
        expect(gaps[4]).toBe(1_500);
        // Full cadence is back immediately after.
        expect(gaps[5]).toBe(3_000);
    });

    it('treats a zero debt cap as no catch-up at all', () => {
        const pacing = resolveEmitPacing({
            now: 1_010_000,
            nextEmitAt: 1_003_000,
            intervalMs: INTERVAL_MS,
            maxDebtBlocks: 0
        });

        expect(pacing.delayMs).toBe(0);
        expect(pacing.nextEmitAt).toBe(1_013_000);
    });
});

describe('resolveBlockAgeInBlocks', () => {
    it('converts a block age in time into an age in blocks', () => {
        const now = 1_000_000;

        expect(resolveBlockAgeInBlocks(new Date(now - 18_000), now, INTERVAL_MS)).toBe(6);
        expect(resolveBlockAgeInBlocks(new Date(now - 90_000), now, INTERVAL_MS)).toBe(30);
    });

    it('reports zero for a block at or ahead of the current clock', () => {
        // Producer clock skew can put a fresh block marginally in the future;
        // that is not negative lag.
        const now = 1_000_000;

        expect(resolveBlockAgeInBlocks(new Date(now), now, INTERVAL_MS)).toBe(0);
        expect(resolveBlockAgeInBlocks(new Date(now + 2_000), now, INTERVAL_MS)).toBe(0);
    });

    it('reports zero rather than Infinity for an unusable interval', () => {
        const now = 1_000_000;

        expect(resolveBlockAgeInBlocks(new Date(now - 60_000), now, 0)).toBe(0);
    });

    it('reports zero for an invalid block timestamp', () => {
        // A malformed header must not be read as an enormous lag that turns
        // pacing off for the rest of the batch.
        expect(resolveBlockAgeInBlocks(new Date(NaN), 1_000_000, INTERVAL_MS)).toBe(0);
    });

    it('reads a backfill block as far behind the head', () => {
        // Backfill work should never be paced at live cadence, and its age says
        // so without needing a separate flag.
        const now = 1_000_000;
        const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1_000);

        expect(resolveBlockAgeInBlocks(twoHoursAgo, now, INTERVAL_MS)).toBe(2_400);
    });
});
