/**
 * Unit tests for the emitter's release arithmetic. Two properties carry the
 * whole design and neither is visible from a single call.
 *
 * The first is that a buffer below target releases *slower* than the chain
 * produces. Without that, a lead spent on one gap never comes back, which is
 * the known limitation of the frontend playout buffer and the reason a backend
 * buffer was worth building at all. The second is that the seed completes on
 * time or on depth, whichever comes first, so a quiet chain cannot leave the
 * feed holding its first block forever.
 */
import { describe, it, expect } from 'vitest';
import { resolveReleaseInterval, resolveSeedComplete, insertPendingBlock } from '../block-emit-buffer.js';

/** Production defaults from `blockchainConfig.emitBuffer`. */
const THRESHOLDS = {
    intervalMs: 3_000,
    refillIntervalMs: 3_300,
    catchupIntervalMs: 2_000,
    targetDepth: 8,
    catchupDepth: 13,
    maxDepth: 40
};

describe('resolveReleaseInterval', () => {
    it('releases at the chain cadence once the buffer holds its target lead', () => {
        expect(resolveReleaseInterval(8, THRESHOLDS)).toBe(3_000);
        expect(resolveReleaseInterval(12, THRESHOLDS)).toBe(3_000);
    });

    it('releases slower than the chain produces while below target', () => {
        // The property the whole buffer rests on. Releasing at exactly the
        // arrival rate would hold whatever depth it had forever, so a lead
        // spent covering one gap could never be rebuilt.
        expect(resolveReleaseInterval(1, THRESHOLDS)).toBe(3_300);
        expect(resolveReleaseInterval(7, THRESHOLDS)).toBe(3_300);
        expect(resolveReleaseInterval(7, THRESHOLDS)).toBeGreaterThan(THRESHOLDS.intervalMs);
    });

    it('drains faster once a tick has delivered more than the lead needs', () => {
        expect(resolveReleaseInterval(13, THRESHOLDS)).toBe(2_000);
        expect(resolveReleaseInterval(39, THRESHOLDS)).toBe(2_000);
    });

    it('stops waiting entirely once depth means latency hurts more than jitter', () => {
        expect(resolveReleaseInterval(40, THRESHOLDS)).toBe(0);
        expect(resolveReleaseInterval(500, THRESHOLDS)).toBe(0);
    });

    it('settles at target rather than drifting below it', () => {
        // Depth is read before the release, so at target the buffer runs at
        // cadence and one block short it slows down. Simulating arrivals at the
        // chain rate has to converge on the target, not sag under it.
        let depth = 0;
        let elapsed = 0;
        const arrivalIntervalMs = 3_000;
        let nextArrivalAt = 0;

        for (let release = 0; release < 200; release += 1) {
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

        expect(depth).toBeGreaterThanOrEqual(THRESHOLDS.targetDepth - 1);
        expect(depth).toBeLessThanOrEqual(THRESHOLDS.targetDepth + 1);
    });
});

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
