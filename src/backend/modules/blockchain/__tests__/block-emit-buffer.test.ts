/**
 * Unit tests for the emitter's release arithmetic. Three properties carry the
 * whole design and none of them is visible from a single call.
 *
 * The first two are the pull toward target from each side. A buffer below
 * target releases *slower* than the chain produces, or a lead spent on one gap
 * never comes back — the flaw in the frontend playout buffer that this one
 * replaced, and the reason a backend buffer was worth building at all. A buffer
 * above target releases *faster*, or a burst that pushed it deep leaves it
 * deep, holding feed latency nobody asked for. Only the exact target releases
 * at the chain's own rate, which is what makes it the one depth the buffer
 * settles at rather than a floor it can sit above.
 *
 * The third is that the seed completes on time or on depth, whichever comes
 * first, so a quiet chain cannot leave the feed holding its first block forever.
 */
import { describe, it, expect } from 'vitest';
import { resolveReleaseInterval, resolveSeedComplete, insertPendingBlock } from '../block-emit-buffer.js';

/**
 * The shipped defaults, from `EMIT_BUFFER_DEFAULTS` plus one TRON block time.
 *
 * `drainIntervalMs` is not stored configuration — `BlockEmitter.resolveThresholds`
 * derives it by mirroring the refill interval about the block time, so the 300ms
 * the default refill sits above 3000ms becomes 300ms below it here.
 */
const THRESHOLDS = {
    intervalMs: 3_000,
    refillIntervalMs: 3_300,
    drainIntervalMs: 2_700,
    catchupIntervalMs: 2_000,
    targetDepth: 8,
    catchupDepth: 13,
    maxDepth: 40
};

describe('resolveReleaseInterval', () => {
    it('releases at the chain cadence at exactly the target lead, and only there', () => {
        // The neutral point has to be a single depth. Applying it to a range
        // would make every depth in that range an equilibrium, so a buffer that
        // arrived at the top of the range would stay there.
        expect(resolveReleaseInterval(8, THRESHOLDS)).toBe(3_000);
        expect(resolveReleaseInterval(9, THRESHOLDS)).not.toBe(3_000);
        expect(resolveReleaseInterval(7, THRESHOLDS)).not.toBe(3_000);
    });

    it('releases slower than the chain produces while below target', () => {
        // The property the whole buffer rests on. Releasing at exactly the
        // arrival rate would hold whatever depth it had forever, so a lead
        // spent covering one gap could never be rebuilt.
        expect(resolveReleaseInterval(1, THRESHOLDS)).toBe(3_300);
        expect(resolveReleaseInterval(7, THRESHOLDS)).toBe(3_300);
        expect(resolveReleaseInterval(7, THRESHOLDS)).toBeGreaterThan(THRESHOLDS.intervalMs);
    });

    it('releases faster than the chain produces while above target', () => {
        // The mirror of the rule above, and the reason a burst does not leave
        // the buffer permanently deep. Every block held past the target is three
        // more seconds between a block existing on TRON and a viewer seeing it,
        // bought for no extra protection.
        expect(resolveReleaseInterval(9, THRESHOLDS)).toBe(2_700);
        expect(resolveReleaseInterval(12, THRESHOLDS)).toBe(2_700);
        expect(resolveReleaseInterval(12, THRESHOLDS)).toBeLessThan(THRESHOLDS.intervalMs);
    });

    it('drains faster once a tick has delivered more than the lead needs', () => {
        expect(resolveReleaseInterval(13, THRESHOLDS)).toBe(2_000);
        expect(resolveReleaseInterval(39, THRESHOLDS)).toBe(2_000);
    });

    it('stops waiting entirely once depth means latency hurts more than jitter', () => {
        expect(resolveReleaseInterval(40, THRESHOLDS)).toBe(0);
        expect(resolveReleaseInterval(500, THRESHOLDS)).toBe(0);
    });

    it.each([
        ['from empty after a restart', 0],
        ['from a burst that stopped short of the catch-up depth', 12],
        ['from a burst that went past the catch-up depth', 20]
    ])('settles at target %s', (_case, startDepth) => {
        // Both correction rules in one check, driven from three starting depths
        // because a buffer can arrive at a given depth from either side and has
        // to end up in the same place. The middle case is the one that used to
        // fail: every depth from target up to the catch-up depth released at the
        // chain's own rate, so a buffer that arrived at 12 stayed at 12 for the
        // life of the process and held four blocks of latency nobody asked for.
        //
        // One block either side, because depth is read before each release and
        // therefore alternates across the target rather than resting exactly on
        // it.
        const settled = simulateSteadyState(startDepth as number);

        expect(settled).toBeGreaterThanOrEqual(THRESHOLDS.targetDepth - 1);
        expect(settled).toBeLessThanOrEqual(THRESHOLDS.targetDepth + 1);
    });
});

/**
 * Run the release clock against arrivals at the chain's own rate and report
 * where depth ends up.
 *
 * Written as a loop over releases rather than as arithmetic on the intervals
 * because the question is about a feedback loop: each release changes the depth
 * that chooses the next interval. Only stepping it can show whether that loop
 * converges, and on what.
 *
 * @param startDepth - Depth to begin from, which is what lets one helper cover
 *                     both approaching target from below and falling back to it
 *                     from above.
 * @returns The depth the buffer holds after enough releases to settle, so a
 *          caller can assert on the equilibrium rather than on any single step.
 */
function simulateSteadyState(startDepth: number): number {
    const arrivalIntervalMs = THRESHOLDS.intervalMs;
    let depth = startDepth;
    let elapsed = 0;
    let nextArrivalAt = 0;

    for (let release = 0; release < 400; release += 1) {
        while (nextArrivalAt <= elapsed) {
            depth += 1;
            nextArrivalAt += arrivalIntervalMs;
        }

        if (depth === 0) {
            elapsed += arrivalIntervalMs;
            continue;
        }

        elapsed += resolveReleaseInterval(depth, THRESHOLDS);
        depth -= 1;
    }

    return depth;
}

describe('resolveSeedComplete', () => {
    it('completes as soon as the buffer holds the target lead', () => {
        expect(resolveSeedComplete({
            depth: 8,
            targetDepth: 8,
            firstArrivalAt: 1_000_000,
            now: 1_000_100,
            intervalMs: 3_000
        })).toBe(true);
    });

    it('keeps holding while the lead is still short and the window is open', () => {
        expect(resolveSeedComplete({
            depth: 3,
            targetDepth: 8,
            firstArrivalAt: 1_000_000,
            now: 1_009_000,
            intervalMs: 3_000
        })).toBe(false);
    });

    it('completes on time even when the depth never arrives', () => {
        // A stalled chain or a quiet test network must not leave the first
        // block held forever. The bound is the same worst case the depth path
        // costs, so it changes when seeding ends and not how long it can take.
        expect(resolveSeedComplete({
            depth: 2,
            targetDepth: 8,
            firstArrivalAt: 1_000_000,
            now: 1_024_000,
            intervalMs: 3_000
        })).toBe(true);
    });

    it('never completes before anything has arrived', () => {
        expect(resolveSeedComplete({
            depth: 0,
            targetDepth: 8,
            firstArrivalAt: null,
            now: 1_999_999,
            intervalMs: 3_000
        })).toBe(false);
    });

    it('treats a zero target as buffering switched off', () => {
        // The behaviour-preserving setting for a staged rollout: no lead is
        // built, so nothing is ever held waiting for one.
        expect(resolveSeedComplete({
            depth: 0,
            targetDepth: 0,
            firstArrivalAt: null,
            now: 1_000_000,
            intervalMs: 3_000
        })).toBe(true);
    });
});

describe('insertPendingBlock', () => {
    it('appends when blocks arrive in order, which is the normal case', () => {
        const pending: Array<{ blockNumber: number }> = [];

        insertPendingBlock(pending, { blockNumber: 1_000 });
        insertPendingBlock(pending, { blockNumber: 1_001 });
        insertPendingBlock(pending, { blockNumber: 1_002 });

        expect(pending.map(item => item.blockNumber)).toEqual([1_000, 1_001, 1_002]);
    });

    it('places a late retry ahead of blocks that overtook it', () => {
        // A block that failed and was retried can land after a later one is
        // already buffered. Releasing them in arrival order would show the feed
        // running backwards.
        const pending: Array<{ blockNumber: number }> = [];

        insertPendingBlock(pending, { blockNumber: 1_000 });
        insertPendingBlock(pending, { blockNumber: 1_002 });
        insertPendingBlock(pending, { blockNumber: 1_001 });

        expect(pending.map(item => item.blockNumber)).toEqual([1_000, 1_001, 1_002]);
    });

    it('places a block older than everything held at the front', () => {
        const pending: Array<{ blockNumber: number }> = [];

        insertPendingBlock(pending, { blockNumber: 1_005 });
        insertPendingBlock(pending, { blockNumber: 1_006 });
        insertPendingBlock(pending, { blockNumber: 1_001 });

        expect(pending.map(item => item.blockNumber)).toEqual([1_001, 1_005, 1_006]);
    });
});
