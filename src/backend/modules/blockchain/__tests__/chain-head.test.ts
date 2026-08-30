/**
 * Unit tests for the rule deciding whether a recorded chain height may stand in
 * for a failed head lookup.
 *
 * One property carries the whole design: the fallback must be refused whenever
 * there is no usable cursor. With a cursor the height is only the ceiling of a
 * forward walk that starts at that cursor, so a stale value shrinks the batch
 * and nothing more. Without one, the service seeds the cursor *from* the
 * height, and a stale value would start the deployment at the wrong block and
 * stay there. The two cases look almost identical at the call site, which is
 * why the rule is pinned here rather than left to a reviewer to notice.
 */
import { describe, it, expect } from 'vitest';
import { resolveCursorBlock, resolveCachedHead } from '../chain-head.js';

/** A plausible recorded height, well clear of the zero and NaN edge cases. */
const CACHED_HEIGHT = 65_000_000;

describe('resolveCursorBlock', () => {
    it('reads a numeric cursor', () => {
        expect(resolveCursorBlock(64_999_998)).toBe(64_999_998);
    });

    it('reads a cursor stored as a string', () => {
        // Older MongoDB driver versions wrote the cursor this way. Rejecting it
        // would read a working deployment as a fresh install and restart its
        // sync from the chain head.
        expect(resolveCursorBlock('64999998')).toBe(64_999_998);
    });

    it('reports no usable cursor for a missing or unreadable value', () => {
        expect(resolveCursorBlock(undefined)).toBeNull();
        expect(resolveCursorBlock(null)).toBeNull();
        expect(resolveCursorBlock('not-a-number')).toBeNull();
        expect(resolveCursorBlock(Number.NaN)).toBeNull();
        expect(resolveCursorBlock({ blockNumber: 5 })).toBeNull();
    });
});

describe('resolveCachedHead', () => {
    it('allows the recorded height when a cursor exists', () => {
        expect(resolveCachedHead(64_999_998, CACHED_HEIGHT)).toBe(CACHED_HEIGHT);
        expect(resolveCachedHead('64999998', CACHED_HEIGHT)).toBe(CACHED_HEIGHT);
    });

    it('refuses the fallback when there is no usable cursor', () => {
        // The property the whole rule exists for. Without a cursor the height
        // is adopted as the sync starting point rather than used as a bound, so
        // a stale value would permanently start the deployment in the wrong
        // place. Aborting the tick and waiting for a live head costs nothing.
        expect(resolveCachedHead(undefined, CACHED_HEIGHT)).toBeNull();
        expect(resolveCachedHead(null, CACHED_HEIGHT)).toBeNull();
        expect(resolveCachedHead('not-a-number', CACHED_HEIGHT)).toBeNull();
    });

    it('refuses a height that was never recorded or cannot be read', () => {
        expect(resolveCachedHead(64_999_998, undefined)).toBeNull();
        expect(resolveCachedHead(64_999_998, '65000000')).toBeNull();
        expect(resolveCachedHead(64_999_998, Number.NaN)).toBeNull();
    });

    it('refuses a non-positive height rather than scheduling from block zero', () => {
        expect(resolveCachedHead(64_999_998, 0)).toBeNull();
        expect(resolveCachedHead(64_999_998, -1)).toBeNull();
    });

    it('returns the height exactly as recorded, never adjusted for elapsed time', () => {
        // Extrapolating forward is the obvious next idea and the harmful one: a
        // height above the real chain head schedules blocks TRON has not
        // produced, and each costs six client retries before landing in
        // cooldown and the backfill queue as a phantom entry.
        expect(resolveCachedHead(1, CACHED_HEIGHT)).toBe(CACHED_HEIGHT);
    });
});
